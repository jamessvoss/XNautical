/**
 * XNautical Cloud Functions
 * 
 * This file contains all Firebase Cloud Functions for XNautical:
 * 
 * 1. AUTHENTICATION & SMS VERIFICATION
 *    - sendVerificationCode, verifyCode, createUserProfile
 * 
 * 2. TIDE PREDICTIONS (NOAA Data)
 *    - updateTidePredictions (scheduled weekly)
 *    - triggerTidePredictionsUpdate (manual trigger)
 * 
 * 3. CURRENT PREDICTIONS (NOAA Tidal Currents)
 *    - populateCurrentsTestBatch (test batch)
 *    - startCurrentsJob (create batch job)
 *    - processCurrentsBatch (Pub/Sub batch processor)
 *    - getCurrentsJobStatus (job status)
 *    - cancelCurrentsJob (cancel job)
 * 
 * 4. MARINE WEATHER FORECASTS (NWS)
 *    - fetchMarineForecasts (scheduled every 10 min, smart polling)
 *    - dailyMarineForecastSummary (scheduled midnight)
 *    - refreshMarineForecasts (manual HTTP trigger)
 * 
 * 5. LIVE BUOY DATA (NOAA NDBC)
 *    - updateBuoyData (scheduled hourly)
 *    - dailyBuoySummary (scheduled midnight)
 *    - triggerBuoyUpdate (manual callable)
 * 
 * Environment Variables Required:
 *   - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER (SMS)
 *   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (Email)
 *   - NOTIFICATION_EMAIL (Admin notifications)
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import * as nodemailer from 'nodemailer';
import BetterSqlite3 from 'better-sqlite3';
import archiver from 'archiver';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as cheerio from 'cheerio';

// Load environment variables
require('dotenv').config();

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();
const bucket = admin.storage().bucket();

// ============================================================================
// TIDE & CURRENT STATION LOCATIONS
// ============================================================================

/**
 * Get all tide and current station locations (without predictions)
 * Returns compact JSON with just the metadata needed for map display
 */
export const getStationLocations = functions
  .runWith({
    memory: '512MB', // Increase memory to handle loading all documents
    timeoutSeconds: 60,
  })
  .https.onCall(async (data, context) => {
    try {
      console.log('Fetching station locations...');
      
      // Fetch both collections in parallel, but only select the fields we need
      const [tideSnapshot, currentSnapshot] = await Promise.all([
        db.collection('tidal-stations')
          .select('name', 'latitude', 'longitude', 'type') // Use latitude/longitude (not lat/lng)
          .get(),
        db.collection('current-stations-packed')
          .select('name', 'latitude', 'longitude') // Current stations don't have a simple bin field
          .get(),
      ]);
      
      // Extract tide station data
      const tideStations = tideSnapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.get('name') || 'Unknown',
        lat: doc.get('latitude') || 0,   // Map latitude -> lat
        lng: doc.get('longitude') || 0,  // Map longitude -> lng
        type: doc.get('type') || 'S',
      }));
      
      // Extract current station data - these are stored differently
      // The catalog document contains all stations in an array
      const currentStations: any[] = [];
      currentSnapshot.docs.forEach(doc => {
        if (doc.id === 'catalog') {
          // Catalog document has locations array
          const locations = doc.get('locations') || [];
          locations.forEach((loc: any) => {
            currentStations.push({
              id: loc.id || loc.noaaId || 'unknown',
              name: loc.name || 'Unknown',
              lat: loc.latitude || 0,
              lng: loc.longitude || 0,
              bin: loc.bin || 0,
            });
          });
        } else {
          // Individual station documents
          currentStations.push({
            id: doc.id,
            name: doc.get('name') || 'Unknown',
            lat: doc.get('latitude') || 0,
            lng: doc.get('longitude') || 0,
            bin: 0,
          });
        }
      });
      
      console.log(`Returning ${tideStations.length} tide stations and ${currentStations.length} current stations`);
      
      return {
        tideStations,
        currentStations,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error fetching station locations:', error);
      throw new functions.https.HttpsError('internal', 'Failed to fetch station locations');
    }
  });

/**
 * Get all tide and current predictions for ALL stations
 * Returns ONLY High/Low events (not full tide curves)
 * Used for bulk download to device for offline access
 * 
 * TIDE PREDICTIONS:
 *   - Stored directly in document as predictions: { "YYYY-MM-DD": [TideEvent, ...] }
 *   - ~4 H/L events per day
 *   - ~3 years of data per station
 * 
 * CURRENT PREDICTIONS:
 *   - Stored in subcollection predictions/{month}
 *   - Packed string format: "HH:MM,f|e|s,velocity,direction|..."
 *   - ~6 events per day (flood/ebb/slack cycles)
 *   - ~3 years of data per station
 */
export const getStationPredictions = functions
  .runWith({
    memory: '8GB',       // Increased to 8GB (max for Gen 1) to handle ~700MB peak memory usage
    timeoutSeconds: 540, // 9 minutes max
  })
  .https.onCall(async (data, context) => {
    try {
      console.log('Packaging all station predictions...');
      const startTime = Date.now();
      
      // TIDE PREDICTIONS: Process in smaller batches to avoid OOM
      console.log('Fetching tide predictions...');
      const tideSnapshot = await db.collection('tidal-stations')
        .select('predictions')
        .get();
      
      const tidePredictions: Record<string, Record<string, any[]>> = {};
      let tideStationCount = 0;
      let tideDateCount = 0;
      
      // Process tide stations in batches to manage memory
      const TIDE_BATCH_SIZE = 50;
      for (let i = 0; i < tideSnapshot.docs.length; i += TIDE_BATCH_SIZE) {
        const batch = tideSnapshot.docs.slice(i, i + TIDE_BATCH_SIZE);
        
        for (const doc of batch) {
          const preds = doc.get('predictions');
          if (preds && typeof preds === 'object') {
            tidePredictions[doc.id] = preds;
            tideStationCount++;
            tideDateCount += Object.keys(preds).length;
          }
        }
        
        // Log progress
        if ((i + TIDE_BATCH_SIZE) % 100 === 0) {
          console.log(`Processed ${Math.min(i + TIDE_BATCH_SIZE, tideSnapshot.docs.length)}/${tideSnapshot.docs.length} tide stations`);
        }
      }
      
      console.log(`Packaged ${tideStationCount} tide stations with ${tideDateCount} total dates`);
      
      // CURRENT PREDICTIONS: Get all station docs with months available
      console.log('Fetching current predictions...');
      const currentStationsSnapshot = await db.collection('current-stations-packed')
        .where(admin.firestore.FieldPath.documentId(), '!=', 'catalog')
        .select('monthsAvailable')
        .get();
      
      const currentPredictions: Record<string, Record<string, any>> = {};
      let currentStationCount = 0;
      let currentMonthCount = 0;
      
      // Process current stations in smaller batches
      const CURRENT_BATCH_SIZE = 25; // Smaller because we fetch subcollections
      const stationDocs = currentStationsSnapshot.docs;
      
      for (let i = 0; i < stationDocs.length; i += CURRENT_BATCH_SIZE) {
        const batch = stationDocs.slice(i, i + CURRENT_BATCH_SIZE);
        
        for (const stationDoc of batch) {
          const monthsAvailable = stationDoc.get('monthsAvailable');
          if (!monthsAvailable || !Array.isArray(monthsAvailable)) continue;
          
          currentPredictions[stationDoc.id] = {};
          
          // Fetch monthly predictions for this station
          for (const month of monthsAvailable) {
            try {
              const predDoc = await db.collection('current-stations-packed')
                .doc(stationDoc.id)
                .collection('predictions')
                .doc(month)
                .get();
              
              if (predDoc.exists) {
                const predData = predDoc.data();
                if (predData && predData.d) {
                  currentPredictions[stationDoc.id][month] = predData.d;
                  currentMonthCount++;
                }
              }
            } catch (err) {
              console.warn(`Error fetching predictions for ${stationDoc.id}/${month}:`, err);
            }
          }
          
          currentStationCount++;
        }
        
        // Log progress every 50 stations
        if ((i + CURRENT_BATCH_SIZE) % 50 === 0 || (i + CURRENT_BATCH_SIZE) >= stationDocs.length) {
          console.log(`Progress: ${Math.min(i + CURRENT_BATCH_SIZE, stationDocs.length)}/${stationDocs.length} current stations processed`);
        }
      }
      
      console.log(`Packaged ${currentStationCount} current stations with ${currentMonthCount} total months`);
      
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      console.log(`Packaging complete in ${elapsedSec} seconds`);
      
      // Calculate data size estimate (for logging) - but don't stringify everything at once
      const tideSampleSize = JSON.stringify(Object.values(tidePredictions)[0] || {}).length;
      const currentSampleSize = JSON.stringify(Object.values(currentPredictions)[0] || {}).length;
      const estimatedTideMB = (tideSampleSize * tideStationCount / 1024 / 1024).toFixed(1);
      const estimatedCurrentMB = (currentSampleSize * currentStationCount / 1024 / 1024).toFixed(1);
      
      console.log(`Estimated tide predictions: ~${estimatedTideMB} MB`);
      console.log(`Estimated current predictions: ~${estimatedCurrentMB} MB`);
      
      return {
        tidePredictions,
        currentPredictions,
        timestamp: new Date().toISOString(),
        stats: {
          tideStations: tideStationCount,
          tideDates: tideDateCount,
          currentStations: currentStationCount,
          currentMonths: currentMonthCount,
          tideSizeMB: parseFloat(estimatedTideMB),
          currentSizeMB: parseFloat(estimatedCurrentMB),
          totalSizeMB: parseFloat(estimatedTideMB) + parseFloat(estimatedCurrentMB),
          processingTimeSec: elapsedSec,
        },
      };
    } catch (error) {
      console.error('Error fetching station predictions:', error);
      throw new functions.https.HttpsError('internal', 'Failed to fetch station predictions');
    }
  });

// ============================================================================
// EMAIL NOTIFICATION SYSTEM
// ============================================================================

// Email transporter for notifications
const emailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

interface JobStats {
  functionName: string;
  status: 'success' | 'partial' | 'failed';
  startTime: Date;
  endTime: Date;
  details: Record<string, any>;
}

/**
 * Send email notification about job completion
 */
async function sendJobNotification(stats: JobStats): Promise<void> {
  const notificationEmail = process.env.NOTIFICATION_EMAIL;
  if (!notificationEmail) {
    console.log('No notification email configured, skipping email');
    return;
  }

  const duration = Math.round((stats.endTime.getTime() - stats.startTime.getTime()) / 1000);
  const statusEmoji = stats.status === 'success' ? '✅' : stats.status === 'partial' ? '⚠️' : '❌';
  const statusText = stats.status.charAt(0).toUpperCase() + stats.status.slice(1);

  // Format details as bullet points
  const detailLines = Object.entries(stats.details)
    .map(([key, value]) => `• ${key}: ${value}`)
    .join('\n');

  const alaskaTime = stats.endTime.toLocaleString('en-US', { 
    timeZone: 'America/Anchorage',
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  const subject = `${statusEmoji} ${stats.functionName} - ${statusText}`;
  
  const text = `
Function: ${stats.functionName}
Status: ${statusText}
Completed: ${alaskaTime} (Alaska Time)
Duration: ${duration} seconds

Results:
${detailLines}
`.trim();

  const html = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: ${stats.status === 'success' ? '#22c55e' : stats.status === 'partial' ? '#f59e0b' : '#ef4444'};">
    ${statusEmoji} ${stats.functionName}
  </h2>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>Status</strong></td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${statusText}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>Completed</strong></td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${alaskaTime} (Alaska)</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>Duration</strong></td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${duration} seconds</td></tr>
  </table>
  <h3 style="margin-top: 20px;">Results</h3>
  <ul style="list-style: none; padding: 0;">
    ${Object.entries(stats.details).map(([key, value]) => 
      `<li style="padding: 4px 0;">• <strong>${key}:</strong> ${value}</li>`
    ).join('')}
  </ul>
  <p style="color: #6b7280; font-size: 12px; margin-top: 20px;">
    XNautical Automated Notification
  </p>
</div>
`.trim();

  try {
    await emailTransporter.sendMail({
      from: `"XNautical Bot" <${process.env.SMTP_USER}>`,
      to: notificationEmail,
      subject,
      text,
      html,
    });
    console.log(`Notification email sent to ${notificationEmail}`);
  } catch (error: any) {
    console.error('Failed to send notification email:', error.message);
  }
}

// ============================================================================
// SMS VERIFICATION (Twilio)
// ============================================================================

// Twilio client - initialized lazily when needed
function getTwilioClient() {
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
  
  if (!twilioAccountSid || !twilioAuthToken) {
    console.error('Twilio credentials not configured');
    return null;
  }
  
  const twilio = require('twilio');
  return twilio(twilioAccountSid, twilioAuthToken);
}

function getTwilioPhoneNumber() {
  return process.env.TWILIO_PHONE_NUMBER;
}

// Generate a random 6-digit code
function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Normalize a phone number to E.164 format
 * - If already has +, use as-is (supports international)
 * - If 10 digits, assume US and add +1
 * - If 11 digits starting with 1, assume US and add +
 * - Otherwise, prepend + and let Twilio validate
 */
function normalizePhoneToE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  
  if (phone.startsWith('+')) {
    return `+${digits}`;
  }
  
  // 10 digits = US number without country code
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // 11 digits starting with 1 = US number with country code but no +
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  
  // Otherwise just add + and let downstream services validate
  return `+${digits}`;
}

/**
 * Send Verification Code
 * 
 * Sends a 6-digit SMS verification code to a phone number.
 * Code expires after 10 minutes.
 */
export const sendVerificationCode = functions.https.onCall(async (data, context) => {
  const { phoneNumber } = data;

  if (!phoneNumber) {
    throw new functions.https.HttpsError('invalid-argument', 'Phone number is required');
  }

  const twilioClient = getTwilioClient();
  const twilioPhoneNumber = getTwilioPhoneNumber();
  
  if (!twilioClient || !twilioPhoneNumber) {
    throw new functions.https.HttpsError('failed-precondition', 'SMS service not configured');
  }

  const code = generateCode();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

  try {
    // Normalize phone for storage key (just digits)
    const phoneKey = phoneNumber.replace(/\D/g, '');
    
    // Store the code in Firestore
    await db.collection('verificationCodes').doc(phoneKey).set({
      code,
      expiresAt,
      attempts: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Format phone number to E.164 for sending
    const formattedPhone = normalizePhoneToE164(phoneNumber);

    // Send SMS via Twilio
    await twilioClient.messages.create({
      body: `Your XNautical verification code is: ${code}. This code expires in 10 minutes.`,
      from: twilioPhoneNumber,
      to: formattedPhone,
    });

    console.log(`Verification code sent to ${formattedPhone}`);
    return { success: true, message: 'Verification code sent' };
  } catch (error: any) {
    console.error('Error sending verification code:', error);
    throw new functions.https.HttpsError('internal', 'Failed to send verification code');
  }
});

/**
 * Verify Code
 * 
 * Verifies a 6-digit SMS code that was sent via sendVerificationCode.
 * - Returns error after 5 failed attempts
 * - Code is deleted after successful verification
 * - Returns error if code is expired (10 min TTL)
 */
export const verifyCode = functions.https.onCall(async (data, context) => {
  const { phoneNumber, code } = data;

  if (!phoneNumber || !code) {
    throw new functions.https.HttpsError('invalid-argument', 'Phone number and code are required');
  }

  // Normalize phone for lookup
  const phoneKey = phoneNumber.replace(/\D/g, '');

  try {
    const docRef = db.collection('verificationCodes').doc(phoneKey);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new functions.https.HttpsError('not-found', 'No verification code found. Please request a new code.');
    }

    const data = doc.data()!;
    
    // Check if expired
    if (Date.now() > data.expiresAt) {
      await docRef.delete();
      throw new functions.https.HttpsError('deadline-exceeded', 'Verification code has expired. Please request a new code.');
    }

    // Check attempts
    if (data.attempts >= 5) {
      await docRef.delete();
      throw new functions.https.HttpsError('resource-exhausted', 'Too many failed attempts. Please request a new code.');
    }

    // Check code
    if (data.code !== code) {
      await docRef.update({ attempts: data.attempts + 1 });
      const remaining = 5 - data.attempts - 1;
      throw new functions.https.HttpsError('permission-denied', `Invalid code. ${remaining} attempts remaining.`);
    }

    // Success - delete the code
    await docRef.delete();
    
    console.log(`Phone ${phoneKey} verified successfully`);
    return { success: true, message: 'Phone number verified successfully' };
  } catch (error: any) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('Error verifying code:', error);
    throw new functions.https.HttpsError('internal', 'Failed to verify code');
  }
});

/**
 * Create User Profile
 * 
 * Creates a user profile document after successful registration.
 */
export const createUserProfile = functions.https.onCall(async (data, context) => {
  // Require authentication
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be authenticated');
  }

  const { fullName, phoneNumber, email } = data;
  const uid = context.auth.uid;

  try {
    // Store phone in E.164 format (preserves country code)
    const normalizedPhone = phoneNumber.startsWith('+') 
      ? phoneNumber 
      : normalizePhoneToE164(phoneNumber);
    
    await db.collection('users').doc(uid).set({
      fullName,
      phoneNumber: normalizedPhone,
      email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`User profile created for ${uid}`);
    return { success: true, message: 'Profile created' };
  } catch (error: any) {
    console.error('Error creating user profile:', error);
    throw new functions.https.HttpsError('internal', 'Failed to create profile');
  }
});

// ============================================================================
// TIDE PREDICTIONS (NOAA Data)
// ============================================================================

const NOAA_TIDES_API = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';

// Format date as YYYYMMDD for NOAA API
function formatDateForNoaa(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// Format date as YYYY-MM-DD for storage keys
function formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Delay helper
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch predictions for a date range, organized by date
async function fetchStationPredictionsByDate(
  stationId: string,
  beginDate: string,
  endDate: string
): Promise<Record<string, Array<{time: string; height: number; type: string}>> | null> {
  try {
    const response = await axios.get(NOAA_TIDES_API, {
      params: {
        station: stationId,
        begin_date: beginDate,
        end_date: endDate,
        product: 'predictions',
        datum: 'MLLW',
        units: 'english',
        time_zone: 'lst_ldt',
        format: 'json',
        interval: 'hilo',
      },
    });

    if (response.data.predictions) {
      // Organize by date (YYYY-MM-DD)
      const byDate: Record<string, Array<{time: string; height: number; type: string}>> = {};
      for (const pred of response.data.predictions) {
        const [datePart, timePart] = pred.t.split(' ');
        if (!byDate[datePart]) {
          byDate[datePart] = [];
        }
        byDate[datePart].push({
          time: timePart,
          height: parseFloat(pred.v),
          type: pred.type,
        });
      }
      return byDate;
    }
    return null;
  } catch (error) {
    return null;
  }
}

/**
 * UPDATE TIDE PREDICTIONS (Scheduled)
 * 
 * Maintains a 3-year rolling window of NOAA tide predictions.
 * 
 * @trigger Pub/Sub Schedule: Every Sunday at 3:00 AM Alaska time
 * @schedule '0 12 * * 0' (12:00 UTC = 3 AM Alaska)
 * 
 * Data Strategy:
 * - Keeps 1 year of historical data
 * - Keeps 2 years of future predictions
 * - Total: 3-year rolling window
 */
export const updateTidePredictions = functions
  .runWith({ 
    timeoutSeconds: 540,
    memory: '1GB',
  })
  .pubsub.schedule('0 12 * * 0') // Every Sunday at 12:00 UTC (3 AM Alaska)
  .timeZone('America/Anchorage')
  .onRun(async (context) => {
    console.log('Starting weekly tide predictions maintenance...');
    const startTime = new Date();

    const now = new Date();
    
    // Calculate date boundaries
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoffDateKey = formatDateKey(oneYearAgo);
    
    // Fetch the next month of data (to extend forward)
    const fetchStart = new Date(now);
    fetchStart.setFullYear(fetchStart.getFullYear() + 2); // Start from 2 years out
    fetchStart.setMonth(fetchStart.getMonth() - 1); // Go back 1 month to ensure overlap
    
    const fetchEnd = new Date(now);
    fetchEnd.setFullYear(fetchEnd.getFullYear() + 2); // End at 2 years out

    const beginDateStr = formatDateForNoaa(fetchStart);
    const endDateStr = formatDateForNoaa(fetchEnd);

    console.log(`Fetching predictions from ${beginDateStr} to ${endDateStr}`);
    console.log(`Deleting data older than ${cutoffDateKey}`);

    try {
      const catalogDoc = await db.collection('tidal-stations').doc('catalog').get();
      
      if (!catalogDoc.exists) {
        console.error('No tidal stations catalog found');
        return null;
      }

      const catalog = catalogDoc.data()!;
      const stations = catalog.stations as Array<{ id: string; name: string }>;
      
      console.log(`Processing ${stations.length} stations...`);

      let successCount = 0;
      let skipCount = 0;
      let deletedDatesCount = 0;

      const BATCH_SIZE = 5; // Smaller batches for more complex operations

      for (let i = 0; i < stations.length; i += BATCH_SIZE) {
        const batch = stations.slice(i, i + BATCH_SIZE);

        for (const station of batch) {
          try {
            // Get current predictions
            const stationDoc = await db.collection('tidal-stations').doc(station.id).get();
            if (!stationDoc.exists) continue;
            
            const stationData = stationDoc.data()!;
            let predictions: Record<string, any> = stationData.predictions || {};

            // 1. Delete old dates (older than 1 year)
            const datesToDelete: string[] = [];
            for (const dateKey of Object.keys(predictions)) {
              if (dateKey < cutoffDateKey) {
                datesToDelete.push(dateKey);
              }
            }
            
            for (const dateKey of datesToDelete) {
              delete predictions[dateKey];
              deletedDatesCount++;
            }

            // 2. Fetch new predictions (next month at the 2-year boundary)
            const newPredictions = await fetchStationPredictionsByDate(
              station.id,
              beginDateStr,
              endDateStr
            );

            if (newPredictions) {
              // Merge new predictions
              predictions = { ...predictions, ...newPredictions };
            }

            // 3. Update Firestore
            const totalDates = Object.keys(predictions).length;
            const totalTides = Object.values(predictions).reduce(
              (sum: number, arr: any) => sum + (Array.isArray(arr) ? arr.length : 0), 
              0
            );

            await db.collection('tidal-stations').doc(station.id).update({
              predictions,
              predictionsUpdated: new Date().toISOString(),
              predictionRange: {
                begin: cutoffDateKey,
                end: formatDateKey(fetchEnd),
              },
              totalDates,
              totalTides,
            });

            successCount++;
          } catch (err) {
            console.warn(`Error processing station ${station.id}:`, err);
            skipCount++;
          }
        }

        // Rate limiting
        if (i + BATCH_SIZE < stations.length) {
          await delay(300);
        }
      }

      // Update catalog
      await db.collection('tidal-stations').doc('catalog').update({
        lastMaintenanceRun: new Date().toISOString(),
        predictionRange: {
          begin: cutoffDateKey,
          end: formatDateKey(fetchEnd),
        },
        dataRetentionPolicy: {
          pastYears: 1,
          futureYears: 2,
          totalYears: 3,
        },
      });

      console.log(`Maintenance complete: ${successCount} updated, ${skipCount} skipped, ${deletedDatesCount} old dates deleted`);
      
      // Send notification email
      await sendJobNotification({
        functionName: 'Tide Predictions Update',
        status: skipCount === 0 ? 'success' : 'partial',
        startTime,
        endTime: new Date(),
        details: {
          'Stations Updated': successCount,
          'Stations Skipped': skipCount,
          'Old Dates Deleted': deletedDatesCount,
          'Date Range': `${cutoffDateKey} to ${formatDateKey(fetchEnd)}`,
          'Next Run': 'Next Sunday 3:00 AM Alaska'
        }
      });
      
      return null;
    } catch (error: any) {
      console.error('Error in tide predictions maintenance:', error);
      
      // Send failure notification
      await sendJobNotification({
        functionName: 'Tide Predictions Update',
        status: 'failed',
        startTime,
        endTime: new Date(),
        details: {
          'Error': error.message || 'Unknown error'
        }
      });
      
      return null;
    }
  });

/**
 * TRIGGER TIDE PREDICTIONS UPDATE (Manual)
 * 
 * Manual trigger for tide predictions maintenance.
 */
export const triggerTidePredictionsUpdate = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    console.log('Manual tide predictions maintenance triggered...');

    const now = new Date();
    
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoffDateKey = formatDateKey(oneYearAgo);
    
    const fetchStart = new Date(now);
    fetchStart.setFullYear(fetchStart.getFullYear() + 2);
    fetchStart.setMonth(fetchStart.getMonth() - 1);
    
    const fetchEnd = new Date(now);
    fetchEnd.setFullYear(fetchEnd.getFullYear() + 2);

    const beginDateStr = formatDateForNoaa(fetchStart);
    const endDateStr = formatDateForNoaa(fetchEnd);

    try {
      const catalogDoc = await db.collection('tidal-stations').doc('catalog').get();
      
      if (!catalogDoc.exists) {
        return { success: false, message: 'No tidal stations catalog found' };
      }

      const catalog = catalogDoc.data()!;
      const stations = catalog.stations as Array<{ id: string; name: string }>;

      let successCount = 0;
      let skipCount = 0;
      let deletedDatesCount = 0;
      const BATCH_SIZE = 5;

      for (let i = 0; i < stations.length; i += BATCH_SIZE) {
        const batch = stations.slice(i, i + BATCH_SIZE);

        for (const station of batch) {
          try {
            const stationDoc = await db.collection('tidal-stations').doc(station.id).get();
            if (!stationDoc.exists) continue;
            
            const stationData = stationDoc.data()!;
            let predictions: Record<string, any> = stationData.predictions || {};

            // Delete old dates
            const datesToDelete: string[] = [];
            for (const dateKey of Object.keys(predictions)) {
              if (dateKey < cutoffDateKey) {
                datesToDelete.push(dateKey);
              }
            }
            
            for (const dateKey of datesToDelete) {
              delete predictions[dateKey];
              deletedDatesCount++;
            }

            // Fetch new predictions
            const newPredictions = await fetchStationPredictionsByDate(
              station.id,
              beginDateStr,
              endDateStr
            );

            if (newPredictions) {
              predictions = { ...predictions, ...newPredictions };
            }

            const totalDates = Object.keys(predictions).length;
            const totalTides = Object.values(predictions).reduce(
              (sum: number, arr: any) => sum + (Array.isArray(arr) ? arr.length : 0), 
              0
            );

            await db.collection('tidal-stations').doc(station.id).update({
              predictions,
              predictionsUpdated: new Date().toISOString(),
              predictionRange: {
                begin: cutoffDateKey,
                end: formatDateKey(fetchEnd),
              },
              totalDates,
              totalTides,
            });

            successCount++;
          } catch (err) {
            skipCount++;
          }
        }

        if (i + BATCH_SIZE < stations.length) {
          await delay(300);
        }
      }

      // Update catalog
      await db.collection('tidal-stations').doc('catalog').update({
        lastMaintenanceRun: new Date().toISOString(),
        predictionRange: {
          begin: cutoffDateKey,
          end: formatDateKey(fetchEnd),
        },
      });

      return {
        success: true,
        message: 'Tide predictions maintenance completed',
        updated: successCount,
        skipped: skipCount,
        deletedDates: deletedDatesCount,
      };
    } catch (error: any) {
      console.error('Error in manual tide predictions update:', error);
      return { success: false, message: error.message };
    }
  });

/**
 * CLEANUP CURRENT PREDICTIONS (Monthly Maintenance)
 * 
 * Maintains a 3-year rolling window of current predictions.
 * Deletes monthly prediction subcollection documents older than 1 year.
 * 
 * @trigger Pub/Sub Schedule: 1st of each month at 2:00 AM Alaska time
 * @schedule '0 10 1 * *' (10:00 UTC on 1st = 2 AM Alaska)
 * 
 * Data Strategy:
 * - Keeps 1 year of historical data
 * - Keeps 2 years of future predictions
 * - Total: 3-year rolling window (36 months)
 */
export const cleanupCurrentPredictions = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '1GB',
  })
  .pubsub.schedule('0 10 1 * *') // 1st of month at 10:00 UTC (2 AM Alaska)
  .timeZone('America/Anchorage')
  .onRun(async (context) => {
    console.log('Starting monthly current predictions cleanup...');
    const startTime = new Date();

    const now = new Date();
    
    // Calculate cutoff month (1 year ago)
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoffMonth = `${oneYearAgo.getFullYear()}-${String(oneYearAgo.getMonth() + 1).padStart(2, '0')}`;
    
    console.log(`Deleting prediction months older than ${cutoffMonth}`);

    try {
      // Get all current station documents (exclude catalog)
      const stationsSnapshot = await db.collection(CURRENTS_COLLECTION)
        .where(admin.firestore.FieldPath.documentId(), '!=', 'catalog')
        .select('monthsAvailable')
        .get();
      
      console.log(`Processing ${stationsSnapshot.docs.length} current stations...`);

      let stationsProcessed = 0;
      let monthsDeleted = 0;
      let skipCount = 0;

      const BATCH_SIZE = 25;

      for (let i = 0; i < stationsSnapshot.docs.length; i += BATCH_SIZE) {
        const batch = stationsSnapshot.docs.slice(i, i + BATCH_SIZE);

        for (const stationDoc of batch) {
          try {
            const monthsAvailable = stationDoc.get('monthsAvailable') || [];
            
            if (!Array.isArray(monthsAvailable) || monthsAvailable.length === 0) {
              skipCount++;
              continue;
            }

            // Split months into keep vs delete
            const monthsToKeep: string[] = [];
            const monthsToDelete: string[] = [];
            
            for (const month of monthsAvailable) {
              if (month < cutoffMonth) {
                monthsToDelete.push(month);
              } else {
                monthsToKeep.push(month);
              }
            }

            // Delete old monthly prediction documents from subcollection
            for (const month of monthsToDelete) {
              await db.collection(CURRENTS_COLLECTION)
                .doc(stationDoc.id)
                .collection('predictions')
                .doc(month)
                .delete();
              monthsDeleted++;
            }

            // Update monthsAvailable array if anything was deleted
            if (monthsToDelete.length > 0) {
              await stationDoc.ref.update({
                monthsAvailable: monthsToKeep,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            }

            stationsProcessed++;
          } catch (err) {
            console.warn(`Error processing station ${stationDoc.id}:`, err);
            skipCount++;
          }
        }

        // Log progress every 50 stations
        if ((i + BATCH_SIZE) % 50 === 0 || (i + BATCH_SIZE) >= stationsSnapshot.docs.length) {
          console.log(`Progress: ${Math.min(i + BATCH_SIZE, stationsSnapshot.docs.length)}/${stationsSnapshot.docs.length} stations`);
        }
      }

      console.log(`Cleanup complete: ${stationsProcessed} stations processed, ${monthsDeleted} old months deleted, ${skipCount} skipped`);
      
      // Send notification email
      await sendJobNotification({
        functionName: 'Current Predictions Cleanup',
        status: skipCount === 0 ? 'success' : 'partial',
        startTime,
        endTime: new Date(),
        details: {
          'Stations Processed': stationsProcessed,
          'Months Deleted': monthsDeleted,
          'Stations Skipped': skipCount,
          'Cutoff Month': cutoffMonth,
          'Next Run': '1st of next month, 2:00 AM Alaska'
        }
      });
      
      return null;
    } catch (error: any) {
      console.error('Error in current predictions cleanup:', error);
      
      // Send failure notification
      await sendJobNotification({
        functionName: 'Current Predictions Cleanup',
        status: 'failed',
        startTime,
        endTime: new Date(),
        details: {
          'Error': error.message || 'Unknown error'
        }
      });
      
      return null;
    }
  });

/**
 * TRIGGER CURRENT PREDICTIONS CLEANUP (Manual)
 * 
 * Manual trigger for current predictions cleanup.
 */
export const triggerCurrentPredictionsCleanup = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    console.log('Manual current predictions cleanup triggered...');
    const startTime = new Date();

    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const cutoffMonth = `${oneYearAgo.getFullYear()}-${String(oneYearAgo.getMonth() + 1).padStart(2, '0')}`;

    try {
      const stationsSnapshot = await db.collection(CURRENTS_COLLECTION)
        .where(admin.firestore.FieldPath.documentId(), '!=', 'catalog')
        .select('monthsAvailable')
        .get();

      console.log(`Processing ${stationsSnapshot.docs.length} stations...`);

      let stationsProcessed = 0;
      let monthsDeleted = 0;
      let skipCount = 0;
      const BATCH_SIZE = 25;

      for (let i = 0; i < stationsSnapshot.docs.length; i += BATCH_SIZE) {
        const batch = stationsSnapshot.docs.slice(i, i + BATCH_SIZE);

        for (const stationDoc of batch) {
          try {
            const monthsAvailable = stationDoc.get('monthsAvailable') || [];
            
            if (!Array.isArray(monthsAvailable) || monthsAvailable.length === 0) {
              skipCount++;
              continue;
            }

            const monthsToKeep: string[] = [];
            const monthsToDelete: string[] = [];
            
            for (const month of monthsAvailable) {
              if (month < cutoffMonth) {
                monthsToDelete.push(month);
              } else {
                monthsToKeep.push(month);
              }
            }

            for (const month of monthsToDelete) {
              await db.collection(CURRENTS_COLLECTION)
                .doc(stationDoc.id)
                .collection('predictions')
                .doc(month)
                .delete();
              monthsDeleted++;
            }

            if (monthsToDelete.length > 0) {
              await stationDoc.ref.update({
                monthsAvailable: monthsToKeep,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            }

            stationsProcessed++;
          } catch (err) {
            console.warn(`Error processing station ${stationDoc.id}:`, err);
            skipCount++;
          }
        }

        if ((i + BATCH_SIZE) % 50 === 0 || (i + BATCH_SIZE) >= stationsSnapshot.docs.length) {
          console.log(`Progress: ${Math.min(i + BATCH_SIZE, stationsSnapshot.docs.length)}/${stationsSnapshot.docs.length} stations`);
        }
      }

      const endTime = new Date();
      const durationSec = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
      
      console.log(`Manual cleanup complete in ${durationSec} seconds`);

      return {
        success: true,
        message: 'Current predictions cleanup completed',
        processed: stationsProcessed,
        deleted: monthsDeleted,
        skipped: skipCount,
        durationSec,
      };
    } catch (error: any) {
      console.error('Error in manual cleanup:', error);
      return { success: false, message: error.message };
    }
  });

// ============================================================================
// PREDICTION DATA BUNDLE GENERATION (Cloud Storage)
// ============================================================================

/**
 * Helper: Create SQLite database for TIDE predictions only
 */
function createTideDatabase(
  tidePredictions: Record<string, any>,
  tideStations: Map<string, { name: string; lat: number; lng: number }>
): { dbPath: string; stats: any } {
  const dbPath = path.join(os.tmpdir(), `tides-${Date.now()}.db`);
  const db = new BetterSqlite3(dbPath);

  console.log('[TIDE DB] Creating SQLite database schema...');
  
  // Create schema - tide only
  db.exec(`
    -- Station metadata
    CREATE TABLE stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );
    
    CREATE INDEX idx_stations_location ON stations(lat, lng);
    
    -- Tide predictions (High/Low events)
    CREATE TABLE tide_predictions (
      station_id TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      type TEXT NOT NULL,
      height REAL NOT NULL,
      PRIMARY KEY (station_id, date, time)
    );
    
    CREATE INDEX idx_tide_date ON tide_predictions(station_id, date);
    
    -- Metadata
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  console.log('[TIDE DB] Inserting station data...');
  
  const insertStation = db.prepare('INSERT OR IGNORE INTO stations (id, name, lat, lng) VALUES (?, ?, ?, ?)');
  const insertTide = db.prepare('INSERT OR IGNORE INTO tide_predictions (station_id, date, time, type, height) VALUES (?, ?, ?, ?, ?)');

  let stationCount = 0;
  let eventCount = 0;

  const insertAllData = db.transaction(() => {
    for (const [stationId, predictions] of Object.entries(tidePredictions)) {
      const stationInfo = tideStations.get(stationId);
      if (stationInfo && Array.isArray(predictions)) {
        insertStation.run(stationId, stationInfo.name, stationInfo.lat, stationInfo.lng);
        stationCount++;
        
        for (const event of predictions) {
          insertTide.run(stationId, event.date, event.time, event.type, event.height);
          eventCount++;
        }
      }
    }

    // Insert metadata
    const insertMetadata = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
    insertMetadata.run('version', '1.0');
    insertMetadata.run('generated', new Date().toISOString());
    insertMetadata.run('type', 'tides');
    insertMetadata.run('stations', String(stationCount));
    insertMetadata.run('events', String(eventCount));
  });

  console.log('[TIDE DB] Writing all data to database...');
  insertAllData();
  
  console.log('[TIDE DB] Optimizing database...');
  db.exec('VACUUM');
  db.exec('ANALYZE');
  
  db.close();
  
  const stats = { stationCount, eventCount };
  console.log(`[TIDE DB] Database created: ${dbPath}`);
  console.log(`[TIDE DB] Stats: ${stationCount} stations, ${eventCount} events`);
  
  return { dbPath, stats };
}

/**
 * Helper: Create SQLite database for CURRENT predictions only
 */
function createCurrentDatabase(
  currentPredictions: Record<string, any>,
  currentStations: Map<string, { name: string; lat: number; lng: number }>
): { dbPath: string; stats: any } {
  const dbPath = path.join(os.tmpdir(), `currents-${Date.now()}.db`);
  const db = new BetterSqlite3(dbPath);

  console.log('[CURRENT DB] Creating SQLite database schema...');
  
  // Create schema - currents only
  db.exec(`
    -- Station metadata
    CREATE TABLE stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );
    
    CREATE INDEX idx_stations_location ON stations(lat, lng);
    
    -- Current predictions (Slack/Max events)
    CREATE TABLE current_predictions (
      station_id TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      type TEXT NOT NULL,
      velocity REAL NOT NULL,
      direction REAL,
      PRIMARY KEY (station_id, date, time)
    );
    
    CREATE INDEX idx_current_date ON current_predictions(station_id, date);
    
    -- Metadata
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  console.log('[CURRENT DB] Inserting station data...');
  
  const insertStation = db.prepare('INSERT OR IGNORE INTO stations (id, name, lat, lng) VALUES (?, ?, ?, ?)');
  const insertCurrent = db.prepare('INSERT OR IGNORE INTO current_predictions (station_id, date, time, type, velocity, direction) VALUES (?, ?, ?, ?, ?, ?)');

  let stationCount = 0;
  let eventCount = 0;

  const insertAllData = db.transaction(() => {
    for (const [stationId, monthlyData] of Object.entries(currentPredictions)) {
      const stationInfo = currentStations.get(stationId);
      if (stationInfo) {
        insertStation.run(stationId, stationInfo.name, stationInfo.lat, stationInfo.lng);
        stationCount++;
        
        // Unpack monthly data - structure: { '2025-02': { month, d: { '1': 'packed', ... }, dayCount } }
        for (const [monthKey, monthDoc] of Object.entries(monthlyData as Record<string, any>)) {
          const packedDays = monthDoc.d || monthDoc;
          
          for (const [dayNum, packedString] of Object.entries(packedDays)) {
            if (typeof packedString !== 'string') continue;
            
            const date = `${monthKey}-${String(dayNum).padStart(2, '0')}`;
            const events = packedString.split('|');
            
            for (const eventStr of events) {
              const parts = eventStr.split(',');
              if (parts.length >= 4) {
                const time = parts[0];
                const type = parts[1];
                const velocity = parseFloat(parts[2]);
                const direction = parts[3] ? parseFloat(parts[3]) : null;
                
                insertCurrent.run(stationId, date, time, type, velocity, direction);
                eventCount++;
              }
            }
          }
        }
      }
    }

    // Insert metadata
    const insertMetadata = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
    insertMetadata.run('version', '1.0');
    insertMetadata.run('generated', new Date().toISOString());
    insertMetadata.run('type', 'currents');
    insertMetadata.run('stations', String(stationCount));
    insertMetadata.run('events', String(eventCount));
  });

  console.log('[CURRENT DB] Writing all data to database...');
  insertAllData();
  
  console.log('[CURRENT DB] Optimizing database...');
  db.exec('VACUUM');
  db.exec('ANALYZE');
  
  db.close();
  
  const stats = { stationCount, eventCount };
  console.log(`[CURRENT DB] Database created: ${dbPath}`);
  console.log(`[CURRENT DB] Stats: ${stationCount} stations, ${eventCount} events`);
  
  return { dbPath, stats };
}

/**
 * Helper: Create SQLite database from prediction data (LEGACY - combined)
 */
function createPredictionDatabase(
  tidePredictions: Record<string, any>,
  currentPredictions: Record<string, any>,
  tideStations: Map<string, { name: string; lat: number; lng: number }>,
  currentStations: Map<string, { name: string; lat: number; lng: number }>
): { dbPath: string; stats: any } {
  // Create temp database file
  const dbPath = path.join(os.tmpdir(), `predictions-${Date.now()}.db`);
  const db = new BetterSqlite3(dbPath);

  console.log('Creating SQLite database schema...');
  
  // Create schema
  db.exec(`
    -- Station metadata
    CREATE TABLE stations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );
    
    CREATE INDEX idx_stations_type ON stations(type);
    CREATE INDEX idx_stations_location ON stations(lat, lng);
    
    -- Tide predictions (High/Low events)
    CREATE TABLE tide_predictions (
      station_id TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      type TEXT NOT NULL,
      height REAL NOT NULL,
      PRIMARY KEY (station_id, date, time)
    );
    
    CREATE INDEX idx_tide_date ON tide_predictions(station_id, date);
    
    -- Current predictions (Slack/Max events)
    CREATE TABLE current_predictions (
      station_id TEXT NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      type TEXT NOT NULL,
      velocity REAL NOT NULL,
      direction REAL,
      PRIMARY KEY (station_id, date, time)
    );
    
    CREATE INDEX idx_current_date ON current_predictions(station_id, date);
    
    -- Metadata
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  console.log('Inserting station data...');
  
  // Insert tide stations
  const insertStation = db.prepare('INSERT OR IGNORE INTO stations (id, name, type, lat, lng) VALUES (?, ?, ?, ?, ?)');
  const insertTide = db.prepare('INSERT OR IGNORE INTO tide_predictions (station_id, date, time, type, height) VALUES (?, ?, ?, ?, ?)');
  const insertCurrent = db.prepare('INSERT OR IGNORE INTO current_predictions (station_id, date, time, type, velocity, direction) VALUES (?, ?, ?, ?, ?, ?)');

  let tideStationCount = 0;
  let tideEventCount = 0;
  let currentStationCount = 0;
  let currentEventCount = 0;

  // Use transaction for better performance
  const insertAllData = db.transaction(() => {
    // Insert tide stations and predictions
    for (const [stationId, predictions] of Object.entries(tidePredictions)) {
      const stationInfo = tideStations.get(stationId);
      if (stationInfo && Array.isArray(predictions)) {
        insertStation.run(stationId, stationInfo.name, 'tide', stationInfo.lat, stationInfo.lng);
        tideStationCount++;
        
        for (const event of predictions) {
          insertTide.run(stationId, event.date, event.time, event.type, event.height);
          tideEventCount++;
        }
      }
    }

    // Insert current stations and predictions
    // DEBUG: Track statistics for logging
    let debugStationsProcessed = 0;
    let debugMonthsProcessed = 0;
    let debugDaysProcessed = 0;
    let debugEventsSkippedNotString = 0;
    let debugEventsSkippedParts = 0;
    let debugSampleStation = 'pct4926'; // Use user's test station
    
    console.log(`[CURRENT DEBUG] Starting to process ${Object.keys(currentPredictions).length} current stations`);
    
    for (const [stationId, monthlyData] of Object.entries(currentPredictions)) {
      const stationInfo = currentStations.get(stationId);
      if (stationInfo) {
        insertStation.run(stationId, stationInfo.name, 'current', stationInfo.lat, stationInfo.lng);
        currentStationCount++;
        debugStationsProcessed++;
        
        // DEBUG: Log structure for sample station
        if (stationId === debugSampleStation) {
          console.log(`[CURRENT DEBUG] ========== SAMPLE STATION: ${stationId} ==========`);
          console.log(`[CURRENT DEBUG] monthlyData type: ${typeof monthlyData}`);
          console.log(`[CURRENT DEBUG] monthlyData keys: ${Object.keys(monthlyData as Record<string, any>).slice(0, 5).join(', ')}...`);
        }
        
        // Unpack monthly data - structure is: { '2025-02': { month: '2025-02', d: { '1': 'packed', '2': 'packed', ... }, dayCount: 28 } }
        for (const [monthKey, monthDoc] of Object.entries(monthlyData as Record<string, any>)) {
          debugMonthsProcessed++;
          
          // DEBUG: Log month document structure for sample station
          if (stationId === debugSampleStation && monthKey === '2026-02') {
            console.log(`[CURRENT DEBUG] --- Month: ${monthKey} ---`);
            console.log(`[CURRENT DEBUG] monthDoc type: ${typeof monthDoc}`);
            console.log(`[CURRENT DEBUG] monthDoc keys: ${Object.keys(monthDoc).join(', ')}`);
            console.log(`[CURRENT DEBUG] monthDoc.d exists: ${!!monthDoc.d}`);
            console.log(`[CURRENT DEBUG] monthDoc.d type: ${typeof monthDoc.d}`);
            if (monthDoc.d) {
              console.log(`[CURRENT DEBUG] monthDoc.d keys (first 5): ${Object.keys(monthDoc.d).slice(0, 5).join(', ')}`);
            }
          }
          
          // The actual daily data is in the 'd' field
          const packedDays = monthDoc.d || monthDoc;
          
          // DEBUG: Log what we're iterating over
          if (stationId === debugSampleStation && monthKey === '2026-02') {
            console.log(`[CURRENT DEBUG] packedDays type: ${typeof packedDays}`);
            console.log(`[CURRENT DEBUG] packedDays keys: ${Object.keys(packedDays).slice(0, 10).join(', ')}`);
          }
          
          for (const [dayNum, packedString] of Object.entries(packedDays)) {
            // DEBUG: Log the raw value for sample
            if (stationId === debugSampleStation && monthKey === '2026-02' && dayNum === '2') {
              console.log(`[CURRENT DEBUG] === Day ${dayNum} ===`);
              console.log(`[CURRENT DEBUG] packedString type: ${typeof packedString}`);
              console.log(`[CURRENT DEBUG] packedString value: ${String(packedString).substring(0, 300)}`);
              console.log(`[CURRENT DEBUG] packedString length: ${String(packedString).length}`);
              console.log(`[CURRENT DEBUG] Contains '|': ${String(packedString).includes('|')}`);
              console.log(`[CURRENT DEBUG] Count of '|': ${(String(packedString).match(/\|/g) || []).length}`);
            }
            
            if (typeof packedString !== 'string') {
              debugEventsSkippedNotString++;
              if (stationId === debugSampleStation && monthKey === '2026-02') {
                console.log(`[CURRENT DEBUG] SKIPPED day ${dayNum}: not a string (type: ${typeof packedString})`);
              }
              continue;
            }
            
            debugDaysProcessed++;
            const date = `${monthKey}-${String(dayNum).padStart(2, '0')}`;
            const events = packedString.split('|');
            
            // DEBUG: Log split results for sample
            if (stationId === debugSampleStation && monthKey === '2026-02' && dayNum === '2') {
              console.log(`[CURRENT DEBUG] After split('|'): ${events.length} events`);
              console.log(`[CURRENT DEBUG] Events array:`, JSON.stringify(events.slice(0, 3)));
            }
            
            let dayEventCount = 0;
            for (const eventStr of events) {
              const parts = eventStr.split(',');
              
              // DEBUG: Log parsing for sample
              if (stationId === debugSampleStation && monthKey === '2026-02' && dayNum === '2' && dayEventCount < 3) {
                console.log(`[CURRENT DEBUG] Event ${dayEventCount}: "${eventStr}" -> ${parts.length} parts: ${JSON.stringify(parts)}`);
              }
              
              if (parts.length >= 4) {
                const time = parts[0];
                const type = parts[1];
                const velocity = parseFloat(parts[2]);
                const direction = parts[3] ? parseFloat(parts[3]) : null;
                
                insertCurrent.run(stationId, date, time, type, velocity, direction);
                currentEventCount++;
                dayEventCount++;
              } else {
                debugEventsSkippedParts++;
                if (stationId === debugSampleStation && monthKey === '2026-02') {
                  console.log(`[CURRENT DEBUG] SKIPPED event: only ${parts.length} parts in "${eventStr}"`);
                }
              }
            }
            
            // DEBUG: Log day summary for sample
            if (stationId === debugSampleStation && monthKey === '2026-02' && dayNum === '2') {
              console.log(`[CURRENT DEBUG] Day ${dayNum} complete: ${dayEventCount} events inserted`);
            }
          }
        }
        
        // DEBUG: Log station summary for sample
        if (stationId === debugSampleStation) {
          console.log(`[CURRENT DEBUG] ========== END SAMPLE STATION ==========`);
        }
      }
    }
    
    // DEBUG: Final summary
    console.log(`[CURRENT DEBUG] ========== FINAL SUMMARY ==========`);
    console.log(`[CURRENT DEBUG] Stations processed: ${debugStationsProcessed}`);
    console.log(`[CURRENT DEBUG] Months processed: ${debugMonthsProcessed}`);
    console.log(`[CURRENT DEBUG] Days processed: ${debugDaysProcessed}`);
    console.log(`[CURRENT DEBUG] Events inserted: ${currentEventCount}`);
    console.log(`[CURRENT DEBUG] Skipped (not string): ${debugEventsSkippedNotString}`);
    console.log(`[CURRENT DEBUG] Skipped (< 4 parts): ${debugEventsSkippedParts}`);
    console.log(`[CURRENT DEBUG] Avg events per day: ${(currentEventCount / debugDaysProcessed).toFixed(2)}`);
    console.log(`[CURRENT DEBUG] ===================================`);

    // Insert metadata
    const insertMetadata = db.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)');
    insertMetadata.run('version', '1.0');
    insertMetadata.run('generated', new Date().toISOString());
    insertMetadata.run('tide_stations', String(tideStationCount));
    insertMetadata.run('current_stations', String(currentStationCount));
    insertMetadata.run('tide_events', String(tideEventCount));
    insertMetadata.run('current_events', String(currentEventCount));
  });

  console.log('Writing all data to database...');
  insertAllData();
  
  // Optimize database
  console.log('Optimizing database...');
  db.exec('VACUUM');
  db.exec('ANALYZE');
  
  db.close();
  
  const stats = {
    tideStationCount,
    tideEventCount,
    currentStationCount,
    currentEventCount,
  };
  
  console.log(`Database created: ${dbPath}`);
  console.log(`Stats:`, stats);
  
  return { dbPath, stats };
}

/**
 * GENERATE PREDICTIONS BUNDLE (Monthly Scheduled)
 * 
 * 1. Fetches all tide and current predictions from Firestore
 * 2. Creates SQLite database
 * 3. Compresses the database using gzip
 * 4. Uploads to Cloud Storage
 * 5. Sends email notification with stats
 * 
 * @trigger Pub/Sub Schedule: 2nd of each month at 3:00 AM Alaska time
 * @schedule '0 11 2 * *' (11:00 UTC on 2nd = 3 AM Alaska)
 * 
 * This runs AFTER:
 * - updateTidePredictions (Sundays at midnight)
 * - cleanupCurrentPredictions (1st of month at 2 AM)
 */
export const generatePredictionsBundle = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '8GB', // Need memory to hold all data
  })
  .pubsub.schedule('0 11 2 * *') // 2nd of month at 11:00 UTC (3 AM Alaska)
  .timeZone('America/Anchorage')
  .onRun(async (context) => {
    console.log('Starting predictions bundle generation...');
    const startTime = new Date();

    try {
      // STEP 1: Fetch all tide predictions and metadata
      console.log('Step 1: Fetching tide predictions from Firestore...');
      const tideSnapshot = await db.collection('tidal-stations').get();
      console.log(`Fetched ${tideSnapshot.size} tide station documents`);
      
      const tidePredictions: Record<string, any> = {};
      const tideStations = new Map<string, { name: string; lat: number; lng: number }>();

      let tideDocsWithPredictions = 0;
      let totalTideEvents = 0;

      for (const doc of tideSnapshot.docs) {
        const data = doc.data();
        
        // Get station metadata
        if (data.name && data.latitude != null && data.longitude != null) {
          tideStations.set(doc.id, {
            name: data.name,
            lat: data.latitude,
            lng: data.longitude,
          });
        }
        
        // Get predictions (stored as object keyed by date)
        if (data.predictions && typeof data.predictions === 'object') {
          tideDocsWithPredictions++;
          // Convert date-keyed object to flat array of events
          const events: Array<{date: string; time: string; type: string; height: number}> = [];
          for (const [date, dayEvents] of Object.entries(data.predictions)) {
            if (Array.isArray(dayEvents)) {
              for (const event of dayEvents) {
                events.push({
                  date,
                  time: event.time,
                  type: event.type,
                  height: event.height,
                });
              }
            }
          }
          if (events.length > 0) {
            tidePredictions[doc.id] = events;
            totalTideEvents += events.length;
          }
        }
      }
      console.log(`Loaded ${tideStations.size} tide stations`);
      console.log(`${tideDocsWithPredictions} stations have predictions`);
      console.log(`Total tide events: ${totalTideEvents}`);

      // STEP 2: Fetch all current predictions and metadata
      console.log('Step 2: Fetching current predictions from Firestore...');
      const currentSnapshot = await db.collection(CURRENTS_COLLECTION)
        .where(admin.firestore.FieldPath.documentId(), '!=', 'catalog')
        .get();
      
      console.log(`Fetched ${currentSnapshot.size} current station documents`);
      
      const currentPredictions: Record<string, any> = {};
      const currentStations = new Map<string, { name: string; lat: number; lng: number }>();

      let currentStationsWithData = 0;
      let totalMonthsFetched = 0;
      const debugSampleStationId = 'pct4926'; // User's test station

      for (const stationDoc of currentSnapshot.docs) {
        const data = stationDoc.data();
        
        // DEBUG: Log sample station's raw document
        if (stationDoc.id === debugSampleStationId) {
          console.log(`[FETCH DEBUG] ===== SAMPLE STATION: ${stationDoc.id} =====`);
          console.log(`[FETCH DEBUG] Document keys: ${Object.keys(data).join(', ')}`);
          console.log(`[FETCH DEBUG] monthsAvailable: ${JSON.stringify(data.monthsAvailable?.slice(0, 5))}...`);
        }
        
        // Get station metadata
        if (data.name && data.latitude != null && data.longitude != null) {
          currentStations.set(stationDoc.id, {
            name: data.name,
            lat: data.latitude,
            lng: data.longitude,
          });
        }
        
        // Fetch all monthly prediction documents
        const monthsAvailable = data.monthsAvailable || [];
        const stationData: Record<string, any> = {};

        for (const month of monthsAvailable) {
          const predDoc = await db.collection(CURRENTS_COLLECTION)
            .doc(stationDoc.id)
            .collection('predictions')
            .doc(month)
            .get();

          if (predDoc.exists) {
            const predData = predDoc.data();
            if (predData) {
              stationData[month] = predData;
              totalMonthsFetched++;
              
              // DEBUG: Log sample station's month document structure
              if (stationDoc.id === debugSampleStationId && month === '2026-02') {
                console.log(`[FETCH DEBUG] --- Month ${month} document ---`);
                console.log(`[FETCH DEBUG] predData keys: ${Object.keys(predData).join(', ')}`);
                console.log(`[FETCH DEBUG] predData.d exists: ${!!predData.d}`);
                if (predData.d) {
                  console.log(`[FETCH DEBUG] predData.d type: ${typeof predData.d}`);
                  const dKeys = Object.keys(predData.d);
                  console.log(`[FETCH DEBUG] predData.d has ${dKeys.length} keys: ${dKeys.slice(0, 5).join(', ')}...`);
                  
                  // Log day 2's data specifically
                  const day2Data = predData.d['2'] || predData.d[2];
                  if (day2Data) {
                    console.log(`[FETCH DEBUG] predData.d['2'] type: ${typeof day2Data}`);
                    console.log(`[FETCH DEBUG] predData.d['2'] length: ${String(day2Data).length}`);
                    console.log(`[FETCH DEBUG] predData.d['2'] value: ${String(day2Data).substring(0, 200)}`);
                    console.log(`[FETCH DEBUG] predData.d['2'] contains '|': ${String(day2Data).includes('|')}`);
                    console.log(`[FETCH DEBUG] predData.d['2'] pipe count: ${(String(day2Data).match(/\|/g) || []).length}`);
                  } else {
                    console.log(`[FETCH DEBUG] predData.d['2'] is undefined/null`);
                    console.log(`[FETCH DEBUG] Available keys in d: ${Object.keys(predData.d).join(', ')}`);
                  }
                }
              }
            }
          }
        }

        if (Object.keys(stationData).length > 0) {
          currentPredictions[stationDoc.id] = stationData;
          currentStationsWithData++;
          
          // DEBUG: Log what we're storing for sample station
          if (stationDoc.id === debugSampleStationId) {
            console.log(`[FETCH DEBUG] Stored ${Object.keys(stationData).length} months for ${stationDoc.id}`);
            console.log(`[FETCH DEBUG] ===== END SAMPLE STATION =====`);
          }
        }
      }
      console.log(`Loaded ${currentStations.size} current stations`);
      console.log(`${currentStationsWithData} stations have prediction data`);
      console.log(`Total months fetched: ${totalMonthsFetched}`);

      // STEP 3: Create SQLite database
      console.log('Step 3: Creating SQLite database...');
      const { dbPath, stats: dbStats } = createPredictionDatabase(
        tidePredictions,
        currentPredictions,
        tideStations,
        currentStations
      );
      
      const dbBuffer = fs.readFileSync(dbPath);
      const uncompressedSize = dbBuffer.length;
      console.log(`Database size: ${(uncompressedSize / 1024 / 1024).toFixed(2)} MB`);

      // STEP 4: Compress with zip (for native decompression on mobile)
      console.log('Step 4: Compressing database with zip...');
      const zipPath = path.join(os.tmpdir(), `predictions-${Date.now()}.zip`);
      
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', {
          zlib: { level: 9 } // Maximum compression
        });
        
        output.on('close', () => {
          console.log(`Zip created: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
          resolve();
        });
        
        archive.on('error', (err) => reject(err));
        archive.pipe(output);
        archive.file(dbPath, { name: 'predictions.db' });
        archive.finalize();
      });
      
      const zipBuffer = fs.readFileSync(zipPath);
      const compressedSize = zipBuffer.length;
      const compressionRatio = ((1 - compressedSize / uncompressedSize) * 100).toFixed(1);
      console.log(`Compressed size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB (${compressionRatio}% reduction)`);
      
      // Clean up temp files
      fs.unlinkSync(dbPath);
      fs.unlinkSync(zipPath);

      // STEP 5: Upload to Cloud Storage
      console.log('Step 5: Uploading to Cloud Storage...');
      
      // Upload compressed database
      const compressedFilename = 'predictions.db.zip';
      const compressedFile = bucket.file(`predictions/${compressedFilename}`);
      
      await compressedFile.save(zipBuffer, {
        metadata: {
          contentType: 'application/zip',
          cacheControl: 'public, max-age=3600',
          metadata: {
            version: '1.0',
            type: 'sqlite',
            generated: new Date().toISOString(),
            tideStations: String(dbStats.tideStationCount),
            currentStations: String(dbStats.currentStationCount),
            tideEvents: String(dbStats.tideEventCount),
            currentEvents: String(dbStats.currentEventCount),
            uncompressedSize: String(uncompressedSize),
            compressedSize: String(compressedSize),
          },
        },
      });

      await compressedFile.makePublic();
      const dbUrl = `https://storage.googleapis.com/${bucket.name}/predictions/${compressedFilename}`;
      console.log(`Uploaded compressed database to: ${dbUrl}`);

      const endTime = new Date();
      const durationSec = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

      // STEP 7: Send email notification
      console.log('Step 7: Sending email notification...');
      await sendJobNotification({
        functionName: 'Predictions Bundle Generation (SQLite)',
        status: 'success',
        startTime,
        endTime,
        details: {
          'Format': 'SQLite Database',
          'Tide Stations': dbStats.tideStationCount,
          'Tide Events': dbStats.tideEventCount,
          'Current Stations': dbStats.currentStationCount,
          'Current Events': dbStats.currentEventCount,
          'Database Size': `${(uncompressedSize / 1024 / 1024).toFixed(2)} MB`,
          'Compressed Size': `${(compressedSize / 1024 / 1024).toFixed(2)} MB`,
          'Compression Ratio': `${compressionRatio}%`,
          'Duration': `${durationSec} seconds`,
          'Download URL': dbUrl,
          'Next Run': '2nd of next month, 3:00 AM Alaska'
        }
      });

      console.log(`Bundle generation complete in ${durationSec} seconds`);
      return null;
    } catch (error: any) {
      console.error('Error generating predictions bundle:', error);
      
      // Send failure notification
      await sendJobNotification({
        functionName: 'Predictions Bundle Generation (SQLite)',
        status: 'failed',
        startTime,
        endTime: new Date(),
        details: {
          'Error': error.message || 'Unknown error',
          'Stack': error.stack || 'No stack trace'
        }
      });
      
      return null;
    }
  });

// ============================================================================
// SEPARATE TIDE AND CURRENT BUNDLE GENERATION (New - Split for reliability)
// ============================================================================

/**
 * GENERATE TIDE BUNDLE (Scheduled)
 * 
 * Generates SQLite database with tide predictions only.
 * Runs faster than combined bundle (~3 min vs ~9 min).
 * 
 * @trigger Pub/Sub Schedule: 2nd of each month at 3:00 AM Alaska time
 */
export const generateTideBundle = functions
  .runWith({
    timeoutSeconds: 300, // 5 minutes should be plenty for tides
    memory: '4GB',
  })
  .pubsub.schedule('0 11 2 * *') // 2nd of month at 11:00 UTC (3 AM Alaska)
  .timeZone('America/Anchorage')
  .onRun(async (context) => {
    console.log('[TIDE BUNDLE] Starting tide bundle generation...');
    const startTime = Date.now();

    try {
      // Fetch tide predictions from Firestore
      console.log('[TIDE BUNDLE] Fetching tide predictions from Firestore...');
      const tideSnapshot = await db.collection('tidal-stations').get();
      console.log(`[TIDE BUNDLE] Fetched ${tideSnapshot.size} tide station documents`);
      
      const tidePredictions: Record<string, any> = {};
      const tideStations = new Map<string, { name: string; lat: number; lng: number }>();

      for (const doc of tideSnapshot.docs) {
        const data = doc.data();
        
        if (data.name && data.latitude != null && data.longitude != null) {
          tideStations.set(doc.id, {
            name: data.name,
            lat: data.latitude,
            lng: data.longitude,
          });
        }
        
        if (data.predictions && typeof data.predictions === 'object') {
          const events: Array<{date: string; time: string; type: string; height: number}> = [];
          for (const [date, dayEvents] of Object.entries(data.predictions)) {
            if (Array.isArray(dayEvents)) {
              for (const event of dayEvents) {
                events.push({
                  date,
                  time: event.time,
                  type: event.type,
                  height: event.height,
                });
              }
            }
          }
          if (events.length > 0) {
            tidePredictions[doc.id] = events;
          }
        }
      }
      console.log(`[TIDE BUNDLE] Loaded ${tideStations.size} stations with predictions`);

      // Create SQLite database
      console.log('[TIDE BUNDLE] Creating SQLite database...');
      const { dbPath, stats } = createTideDatabase(tidePredictions, tideStations);
      
      const dbBuffer = fs.readFileSync(dbPath);
      const uncompressedSize = dbBuffer.length;
      console.log(`[TIDE BUNDLE] Database size: ${(uncompressedSize / 1024 / 1024).toFixed(2)} MB`);

      // Compress with zip
      console.log('[TIDE BUNDLE] Compressing database...');
      const zipPath = path.join(os.tmpdir(), `tides-${Date.now()}.zip`);
      
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));
        archive.pipe(output);
        archive.file(dbPath, { name: 'tides.db' });
        archive.finalize();
      });
      
      const zipBuffer = fs.readFileSync(zipPath);
      const compressedSize = zipBuffer.length;
      console.log(`[TIDE BUNDLE] Compressed size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
      
      // Clean up temp files
      fs.unlinkSync(dbPath);
      fs.unlinkSync(zipPath);

      // Upload to Cloud Storage
      console.log('[TIDE BUNDLE] Uploading to Cloud Storage...');
      const file = bucket.file('predictions/tides.db.zip');
      
      await file.save(zipBuffer, {
        metadata: {
          contentType: 'application/zip',
          cacheControl: 'public, max-age=3600',
          metadata: {
            version: '1.0',
            type: 'tides',
            generated: new Date().toISOString(),
            stations: String(stats.stationCount),
            events: String(stats.eventCount),
          },
        },
      });

      const elapsed = Date.now() - startTime;
      console.log(`[TIDE BUNDLE] ✅ Complete! ${stats.stationCount} stations, ${stats.eventCount} events in ${(elapsed/1000).toFixed(1)}s`);
      
      return { success: true, stats, elapsed };
    } catch (error: any) {
      console.error('[TIDE BUNDLE] ❌ Error:', error.message);
      throw error;
    }
  });

/**
 * TRIGGER TIDE BUNDLE (Manual HTTP callable)
 */
export const triggerTideBundle = functions
  .runWith({ timeoutSeconds: 300, memory: '4GB' })
  .https.onCall(async (data, context) => {
    console.log('[TIDE BUNDLE] Manual trigger...');
    const startTime = Date.now();

    try {
      // Fetch tide predictions from Firestore
      console.log('[TIDE BUNDLE] Fetching tide predictions from Firestore...');
      const tideSnapshot = await db.collection('tidal-stations').get();
      console.log(`[TIDE BUNDLE] Fetched ${tideSnapshot.size} tide station documents`);
      
      const tidePredictions: Record<string, any> = {};
      const tideStations = new Map<string, { name: string; lat: number; lng: number }>();

      for (const doc of tideSnapshot.docs) {
        const data = doc.data();
        
        if (data.name && data.latitude != null && data.longitude != null) {
          tideStations.set(doc.id, {
            name: data.name,
            lat: data.latitude,
            lng: data.longitude,
          });
        }
        
        if (data.predictions && typeof data.predictions === 'object') {
          const events: Array<{date: string; time: string; type: string; height: number}> = [];
          for (const [date, dayEvents] of Object.entries(data.predictions)) {
            if (Array.isArray(dayEvents)) {
              for (const event of dayEvents) {
                events.push({
                  date,
                  time: event.time,
                  type: event.type,
                  height: event.height,
                });
              }
            }
          }
          if (events.length > 0) {
            tidePredictions[doc.id] = events;
          }
        }
      }
      console.log(`[TIDE BUNDLE] Loaded ${tideStations.size} stations with predictions`);

      // Create SQLite database
      console.log('[TIDE BUNDLE] Creating SQLite database...');
      const { dbPath, stats } = createTideDatabase(tidePredictions, tideStations);
      
      const dbBuffer = fs.readFileSync(dbPath);
      const uncompressedSize = dbBuffer.length;
      console.log(`[TIDE BUNDLE] Database size: ${(uncompressedSize / 1024 / 1024).toFixed(2)} MB`);

      // Compress with zip
      console.log('[TIDE BUNDLE] Compressing database...');
      const zipPath = path.join(os.tmpdir(), `tides-${Date.now()}.zip`);
      
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));
        archive.pipe(output);
        archive.file(dbPath, { name: 'tides.db' });
        archive.finalize();
      });
      
      const zipBuffer = fs.readFileSync(zipPath);
      const compressedSize = zipBuffer.length;
      console.log(`[TIDE BUNDLE] Compressed size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
      
      // Clean up temp files
      fs.unlinkSync(dbPath);
      fs.unlinkSync(zipPath);

      // Upload to Cloud Storage
      console.log('[TIDE BUNDLE] Uploading to Cloud Storage...');
      const file = bucket.file('predictions/tides.db.zip');
      
      await file.save(zipBuffer, {
        metadata: {
          contentType: 'application/zip',
          cacheControl: 'public, max-age=3600',
          metadata: {
            version: '1.0',
            type: 'tides',
            generated: new Date().toISOString(),
            stations: String(stats.stationCount),
            events: String(stats.eventCount),
          },
        },
      });

      const elapsed = Date.now() - startTime;
      console.log(`[TIDE BUNDLE] ✅ Complete! ${stats.stationCount} stations, ${stats.eventCount} events in ${(elapsed/1000).toFixed(1)}s`);
      
      return { success: true, stats, elapsed };
    } catch (error: any) {
      console.error('[TIDE BUNDLE] ❌ Error:', error.message);
      throw new functions.https.HttpsError('internal', error.message);
    }
  });

/**
 * Helper: Fetch all monthly predictions for a station in PARALLEL
 */
async function fetchStationMonthsParallel(
  stationId: string,
  monthsAvailable: string[]
): Promise<Record<string, any>> {
  const stationData: Record<string, any> = {};
  
  // Fetch all months in parallel
  const results = await Promise.all(
    monthsAvailable.map(async (month) => {
      const predDoc = await db.collection(CURRENTS_COLLECTION)
        .doc(stationId)
        .collection('predictions')
        .doc(month)
        .get();
      
      if (predDoc.exists) {
        return { month, data: predDoc.data() };
      }
      return null;
    })
  );
  
  for (const result of results) {
    if (result && result.data) {
      stationData[result.month] = result.data;
    }
  }
  
  return stationData;
}

/**
 * GENERATE CURRENTS BUNDLE (Scheduled)
 * 
 * Generates SQLite database with current predictions only.
 * This is the larger of the two bundles (~7.5M events).
 * Uses PARALLEL fetching for much faster Firestore reads.
 * 
 * @trigger Pub/Sub Schedule: 2nd of each month at 3:05 AM Alaska time (5 min after tides)
 */
export const generateCurrentsBundle = functions
  .runWith({
    timeoutSeconds: 540, // 9 minutes for currents (larger dataset)
    memory: '8GB',
  })
  .pubsub.schedule('5 11 2 * *') // 2nd of month at 11:05 UTC (3:05 AM Alaska)
  .timeZone('America/Anchorage')
  .onRun(async (context) => {
    console.log('[CURRENTS BUNDLE] Starting currents bundle generation...');
    const startTime = Date.now();

    try {
      // Fetch current predictions from Firestore
      console.log('[CURRENTS BUNDLE] Fetching current station documents...');
      const currentSnapshot = await db.collection(CURRENTS_COLLECTION)
        .where(admin.firestore.FieldPath.documentId(), '!=', 'catalog')
        .get();
      
      console.log(`[CURRENTS BUNDLE] Fetched ${currentSnapshot.size} current station documents`);
      
      const currentPredictions: Record<string, any> = {};
      const currentStations = new Map<string, { name: string; lat: number; lng: number }>();
      let totalMonthsFetched = 0;

      // Process stations in batches for parallel fetching
      const BATCH_SIZE = 50; // Process 50 stations at a time
      const stationDocs = currentSnapshot.docs;
      
      console.log(`[CURRENTS BUNDLE] Processing ${stationDocs.length} stations in batches of ${BATCH_SIZE}...`);
      
      for (let i = 0; i < stationDocs.length; i += BATCH_SIZE) {
        const batch = stationDocs.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(stationDocs.length / BATCH_SIZE);
        
        // Process this batch of stations in parallel
        const batchResults = await Promise.all(
          batch.map(async (stationDoc) => {
            const data = stationDoc.data();
            
            let stationInfo = null;
            if (data.name && data.latitude != null && data.longitude != null) {
              stationInfo = {
                id: stationDoc.id,
                name: data.name,
                lat: data.latitude,
                lng: data.longitude,
              };
            }
            
            const monthsAvailable = data.monthsAvailable || [];
            const stationData = await fetchStationMonthsParallel(stationDoc.id, monthsAvailable);
            
            return {
              stationId: stationDoc.id,
              stationInfo,
              stationData,
              monthCount: Object.keys(stationData).length,
            };
          })
        );
        
        // Collect results from this batch
        for (const result of batchResults) {
          if (result.stationInfo) {
            currentStations.set(result.stationId, {
              name: result.stationInfo.name,
              lat: result.stationInfo.lat,
              lng: result.stationInfo.lng,
            });
          }
          if (Object.keys(result.stationData).length > 0) {
            currentPredictions[result.stationId] = result.stationData;
            totalMonthsFetched += result.monthCount;
          }
        }
        
        console.log(`[CURRENTS BUNDLE] Batch ${batchNum}/${totalBatches} complete (${totalMonthsFetched} months so far)`);
      }
      
      console.log(`[CURRENTS BUNDLE] Loaded ${currentStations.size} stations, ${totalMonthsFetched} months`);

      // Create SQLite database
      console.log('[CURRENTS BUNDLE] Creating SQLite database...');
      const { dbPath, stats } = createCurrentDatabase(currentPredictions, currentStations);
      
      const dbBuffer = fs.readFileSync(dbPath);
      const uncompressedSize = dbBuffer.length;
      console.log(`[CURRENTS BUNDLE] Database size: ${(uncompressedSize / 1024 / 1024).toFixed(2)} MB`);

      // Compress with zip
      console.log('[CURRENTS BUNDLE] Compressing database...');
      const zipPath = path.join(os.tmpdir(), `currents-${Date.now()}.zip`);
      
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));
        archive.pipe(output);
        archive.file(dbPath, { name: 'currents.db' });
        archive.finalize();
      });
      
      const zipBuffer = fs.readFileSync(zipPath);
      const compressedSize = zipBuffer.length;
      console.log(`[CURRENTS BUNDLE] Compressed size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
      
      // Clean up temp files
      fs.unlinkSync(dbPath);
      fs.unlinkSync(zipPath);

      // Upload to Cloud Storage
      console.log('[CURRENTS BUNDLE] Uploading to Cloud Storage...');
      const file = bucket.file('predictions/currents.db.zip');
      
      await file.save(zipBuffer, {
        metadata: {
          contentType: 'application/zip',
          cacheControl: 'public, max-age=3600',
          metadata: {
            version: '1.0',
            type: 'currents',
            generated: new Date().toISOString(),
            stations: String(stats.stationCount),
            events: String(stats.eventCount),
          },
        },
      });

      const elapsed = Date.now() - startTime;
      console.log(`[CURRENTS BUNDLE] ✅ Complete! ${stats.stationCount} stations, ${stats.eventCount} events in ${(elapsed/1000).toFixed(1)}s`);
      
      return { success: true, stats, elapsed };
    } catch (error: any) {
      console.error('[CURRENTS BUNDLE] ❌ Error:', error.message);
      throw error;
    }
  });

/**
 * TRIGGER CURRENTS BUNDLE (Manual HTTP callable)
 * Uses PARALLEL fetching for much faster Firestore reads.
 */
export const triggerCurrentsBundle = functions
  .runWith({ timeoutSeconds: 540, memory: '8GB' })
  .https.onCall(async (data, context) => {
    console.log('[CURRENTS BUNDLE] Manual trigger (parallel fetch)...');
    const startTime = Date.now();

    try {
      // Fetch current predictions from Firestore
      console.log('[CURRENTS BUNDLE] Fetching current station documents...');
      const currentSnapshot = await db.collection(CURRENTS_COLLECTION)
        .where(admin.firestore.FieldPath.documentId(), '!=', 'catalog')
        .get();
      
      console.log(`[CURRENTS BUNDLE] Fetched ${currentSnapshot.size} current station documents`);
      
      const currentPredictions: Record<string, any> = {};
      const currentStations = new Map<string, { name: string; lat: number; lng: number }>();
      let totalMonthsFetched = 0;

      // Process stations in batches for parallel fetching
      const BATCH_SIZE = 50; // Process 50 stations at a time
      const stationDocs = currentSnapshot.docs;
      
      console.log(`[CURRENTS BUNDLE] Processing ${stationDocs.length} stations in batches of ${BATCH_SIZE}...`);
      
      for (let i = 0; i < stationDocs.length; i += BATCH_SIZE) {
        const batch = stationDocs.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(stationDocs.length / BATCH_SIZE);
        
        // Process this batch of stations in parallel
        const batchResults = await Promise.all(
          batch.map(async (stationDoc) => {
            const docData = stationDoc.data();
            
            let stationInfo = null;
            if (docData.name && docData.latitude != null && docData.longitude != null) {
              stationInfo = {
                id: stationDoc.id,
                name: docData.name,
                lat: docData.latitude,
                lng: docData.longitude,
              };
            }
            
            const monthsAvailable = docData.monthsAvailable || [];
            const stationData = await fetchStationMonthsParallel(stationDoc.id, monthsAvailable);
            
            return {
              stationId: stationDoc.id,
              stationInfo,
              stationData,
              monthCount: Object.keys(stationData).length,
            };
          })
        );
        
        // Collect results from this batch
        for (const result of batchResults) {
          if (result.stationInfo) {
            currentStations.set(result.stationId, {
              name: result.stationInfo.name,
              lat: result.stationInfo.lat,
              lng: result.stationInfo.lng,
            });
          }
          if (Object.keys(result.stationData).length > 0) {
            currentPredictions[result.stationId] = result.stationData;
            totalMonthsFetched += result.monthCount;
          }
        }
        
        console.log(`[CURRENTS BUNDLE] Batch ${batchNum}/${totalBatches} complete (${totalMonthsFetched} months so far)`);
      }
      
      console.log(`[CURRENTS BUNDLE] Loaded ${currentStations.size} stations, ${totalMonthsFetched} months`);

      // Create SQLite database
      console.log('[CURRENTS BUNDLE] Creating SQLite database...');
      const { dbPath, stats } = createCurrentDatabase(currentPredictions, currentStations);
      
      const dbBuffer = fs.readFileSync(dbPath);
      const uncompressedSize = dbBuffer.length;
      console.log(`[CURRENTS BUNDLE] Database size: ${(uncompressedSize / 1024 / 1024).toFixed(2)} MB`);

      // Compress with zip
      console.log('[CURRENTS BUNDLE] Compressing database...');
      const zipPath = path.join(os.tmpdir(), `currents-${Date.now()}.zip`);
      
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));
        archive.pipe(output);
        archive.file(dbPath, { name: 'currents.db' });
        archive.finalize();
      });
      
      const zipBuffer = fs.readFileSync(zipPath);
      const compressedSize = zipBuffer.length;
      console.log(`[CURRENTS BUNDLE] Compressed size: ${(compressedSize / 1024 / 1024).toFixed(2)} MB`);
      
      // Clean up temp files
      fs.unlinkSync(dbPath);
      fs.unlinkSync(zipPath);

      // Upload to Cloud Storage
      console.log('[CURRENTS BUNDLE] Uploading to Cloud Storage...');
      const file = bucket.file('predictions/currents.db.zip');
      
      await file.save(zipBuffer, {
        metadata: {
          contentType: 'application/zip',
          cacheControl: 'public, max-age=3600',
          metadata: {
            version: '1.0',
            type: 'currents',
            generated: new Date().toISOString(),
            stations: String(stats.stationCount),
            events: String(stats.eventCount),
          },
        },
      });

      const elapsed = Date.now() - startTime;
      console.log(`[CURRENTS BUNDLE] ✅ Complete! ${stats.stationCount} stations, ${stats.eventCount} events in ${(elapsed/1000).toFixed(1)}s`);
      
      return { success: true, stats, elapsed };
    } catch (error: any) {
      console.error('[CURRENTS BUNDLE] ❌ Error:', error.message);
      throw new functions.https.HttpsError('internal', error.message);
    }
  });

/**
 * TRIGGER BUNDLE GENERATION (Manual - LEGACY)
 * 
 * Manual trigger for testing bundle generation.
 */
export const triggerBundleGeneration = functions
  .runWith({ timeoutSeconds: 540, memory: '8GB' })
  .https.onCall(async (data, context) => {
    console.log('Manual bundle generation triggered (SQLite)...');
    const startTime = new Date();

    try {
      // STEP 1: Fetch tide predictions and metadata
      console.log('Step 1: Fetching tide predictions from Firestore...');
      const tideSnapshot = await db.collection('tidal-stations').get();
      console.log(`Fetched ${tideSnapshot.size} tide station documents`);
      
      const tidePredictions: Record<string, any> = {};
      const tideStations = new Map<string, { name: string; lat: number; lng: number }>();

      let tideDocsWithPredictions = 0;
      let totalTideEvents = 0;

      for (const doc of tideSnapshot.docs) {
        const data = doc.data();
        
        // Get station metadata
        if (data.name && data.latitude != null && data.longitude != null) {
          tideStations.set(doc.id, {
            name: data.name,
            lat: data.latitude,
            lng: data.longitude,
          });
        }
        
        // Get predictions (stored as object keyed by date)
        if (data.predictions && typeof data.predictions === 'object') {
          tideDocsWithPredictions++;
          // Convert date-keyed object to flat array of events
          const events: Array<{date: string; time: string; type: string; height: number}> = [];
          for (const [date, dayEvents] of Object.entries(data.predictions)) {
            if (Array.isArray(dayEvents)) {
              for (const event of dayEvents) {
                events.push({
                  date,
                  time: event.time,
                  type: event.type,
                  height: event.height,
                });
              }
            }
          }
          if (events.length > 0) {
            tidePredictions[doc.id] = events;
            totalTideEvents += events.length;
          }
        }
      }
      console.log(`Loaded ${tideStations.size} tide stations`);
      console.log(`${tideDocsWithPredictions} stations have predictions`);
      console.log(`Total tide events: ${totalTideEvents}`);

      // STEP 2: Fetch current predictions and metadata
      console.log('Step 2: Fetching current predictions from Firestore...');
      const currentSnapshot = await db.collection(CURRENTS_COLLECTION)
        .where(admin.firestore.FieldPath.documentId(), '!=', 'catalog')
        .get();
      
      console.log(`Fetched ${currentSnapshot.size} current station documents`);
      
      const currentPredictions: Record<string, any> = {};
      const currentStations = new Map<string, { name: string; lat: number; lng: number }>();

      let currentStationsWithData = 0;
      let totalMonthsFetched = 0;

      for (const stationDoc of currentSnapshot.docs) {
        const data = stationDoc.data();
        
        // Get station metadata
        if (data.name && data.latitude != null && data.longitude != null) {
          currentStations.set(stationDoc.id, {
            name: data.name,
            lat: data.latitude,
            lng: data.longitude,
          });
        }
        
        // Fetch all monthly prediction documents
        const monthsAvailable = data.monthsAvailable || [];
        const stationData: Record<string, any> = {};

        for (const month of monthsAvailable) {
          const predDoc = await db.collection(CURRENTS_COLLECTION)
            .doc(stationDoc.id)
            .collection('predictions')
            .doc(month)
            .get();

          if (predDoc.exists) {
            const predData = predDoc.data();
            if (predData) {
              stationData[month] = predData;
              totalMonthsFetched++;
            }
          }
        }

        if (Object.keys(stationData).length > 0) {
          currentPredictions[stationDoc.id] = stationData;
          currentStationsWithData++;
        }
      }
      console.log(`Loaded ${currentStations.size} current stations`);
      console.log(`${currentStationsWithData} stations have prediction data`);
      console.log(`Total months fetched: ${totalMonthsFetched}`);

      // Create SQLite database
      const { dbPath, stats: dbStats } = createPredictionDatabase(
        tidePredictions,
        currentPredictions,
        tideStations,
        currentStations
      );
      
      const dbBuffer = fs.readFileSync(dbPath);
      const uncompressedSize = dbBuffer.length;
      
      // Compress with zip
      const zipPath = path.join(os.tmpdir(), `predictions-trigger-${Date.now()}.zip`);
      await new Promise<void>((resolve, reject) => {
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        output.on('close', () => resolve());
        archive.on('error', (err) => reject(err));
        archive.pipe(output);
        archive.file(dbPath, { name: 'predictions.db' });
        archive.finalize();
      });
      
      const zipBuffer = fs.readFileSync(zipPath);
      const compressedSize = zipBuffer.length;
      const compressionRatio = ((1 - compressedSize / uncompressedSize) * 100).toFixed(1);
      
      fs.unlinkSync(dbPath);
      fs.unlinkSync(zipPath);

      // Upload to Cloud Storage
      const compressedFilename = 'predictions.db.zip';
      const compressedFile = bucket.file(`predictions/${compressedFilename}`);
      
      await compressedFile.save(zipBuffer, {
        metadata: {
          contentType: 'application/zip',
          cacheControl: 'public, max-age=3600',
          metadata: {
            version: '1.0',
            type: 'sqlite',
            generated: new Date().toISOString(),
            tideStations: String(dbStats.tideStationCount),
            currentStations: String(dbStats.currentStationCount),
            tideEvents: String(dbStats.tideEventCount),
            currentEvents: String(dbStats.currentEventCount),
            uncompressedSize: String(uncompressedSize),
            compressedSize: String(compressedSize),
          },
        },
      });

      await compressedFile.makePublic();
      const dbUrl = `https://storage.googleapis.com/${bucket.name}/predictions/${compressedFilename}`;

      const endTime = new Date();
      const durationSec = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

      return {
        success: true,
        message: 'Bundle generation completed (SQLite)',
        format: 'sqlite',
        tideStations: dbStats.tideStationCount,
        tideEvents: dbStats.tideEventCount,
        currentStations: dbStats.currentStationCount,
        currentEvents: dbStats.currentEventCount,
        databaseSizeMB: (uncompressedSize / 1024 / 1024).toFixed(2),
        compressedSizeMB: (compressedSize / 1024 / 1024).toFixed(2),
        compressionRatio: `${compressionRatio}%`,
        downloadUrl: dbUrl,
        durationSec,
      };
    } catch (error: any) {
      console.error('Error in manual bundle generation:', error);
      return { success: false, message: error.message };
    }
  });

// ============================================================================
// CURRENT PREDICTIONS (NOAA Tidal Currents) - PACKED FORMAT
// ============================================================================

const CURRENTS_COLLECTION = 'current-stations-packed';
const NOAA_CURRENTS_API = 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter';
const CURRENTS_BATCH_TOPIC = 'process-currents-batch';

interface CurrentPrediction {
  time: string;
  velocity: number;
  direction: number;
  type: 'flood' | 'ebb' | 'slack';
}

interface CurrentsJobStation {
  id: string;
  name: string;
  noaaId: string;
  lat: number;
  lng: number;
  bin: number;
  depth: number | null;
  depthType: string;
  baseStationId: string;
}

interface CurrentsJob {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  config: {
    startDate: string;
    endDate: string;
    batchSize: number;
    totalStations: number;
    totalBatches: number;
  };
  progress: {
    batchesCompleted: number;
    stationsProcessed: number;
    stationsFailed: number;
  };
  createdAt: admin.firestore.Timestamp;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Fetch current predictions from NOAA API
 */
async function fetchCurrentPredictions(
  stationId: string,
  bin: number,
  startDate: Date,
  endDate: Date
): Promise<any[]> {
  const formatDate = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  };

  const params: Record<string, string> = {
    station: stationId,
    begin_date: formatDate(startDate),
    end_date: formatDate(endDate),
    product: 'currents_predictions',
    interval: 'MAX_SLACK',
    units: 'english',
    time_zone: 'lst_ldt',
    format: 'json',
    bin: String(bin),
  };

  const url = `${NOAA_CURRENTS_API}?${new URLSearchParams(params).toString()}`;

  try {
    const response = await axios.get(url, { timeout: 30000 });
    const data = response.data;

    if (data.error) {
      console.warn(`NOAA API error for ${stationId}: ${JSON.stringify(data.error)}`);
      return [];
    }

    return data.current_predictions?.cp || data.current_predictions || [];
  } catch (err: any) {
    console.warn(`Error fetching predictions for ${stationId}: ${err.message}`);
    return [];
  }
}

/**
 * Organize predictions by month with correct direction handling
 */
function organizeByMonth(predictions: any[]): Map<string, Record<string, CurrentPrediction[]>> {
  const byMonth = new Map<string, Record<string, CurrentPrediction[]>>();

  if (!predictions || !Array.isArray(predictions)) return byMonth;

  for (const pred of predictions) {
    if (!pred || !pred.Time) continue;

    const [datePart, timePart] = pred.Time.split(' ');
    if (!datePart || !timePart) continue;

    const monthKey = datePart.substring(0, 7); // YYYY-MM
    const dateStr = datePart;

    if (!byMonth.has(monthKey)) {
      byMonth.set(monthKey, {});
    }

    const monthData = byMonth.get(monthKey)!;
    if (!monthData[dateStr]) {
      monthData[dateStr] = [];
    }

    // Determine type
    let type: 'flood' | 'ebb' | 'slack';
    if (pred.Type) {
      type = pred.Type.toLowerCase() as 'flood' | 'ebb' | 'slack';
    } else if (Math.abs(pred.Velocity_Major || 0) < 0.1) {
      type = 'slack';
    } else if ((pred.Velocity_Major || 0) > 0) {
      type = 'flood';
    } else {
      type = 'ebb';
    }

    // Use correct direction based on type
    let direction = 0;
    if (type === 'flood') {
      direction = parseFloat(pred.meanFloodDir) || 0;
    } else if (type === 'ebb') {
      direction = parseFloat(pred.meanEbbDir) || 0;
    } else {
      // For slack, use flood direction as default
      direction = parseFloat(pred.meanFloodDir) || parseFloat(pred.meanEbbDir) || 0;
    }

    monthData[dateStr].push({
      time: timePart.slice(0, 5),
      velocity: Math.round((parseFloat(pred.Velocity_Major) || 0) * 100) / 100,
      direction: Math.round(direction),
      type,
    });
  }

  // Sort each day's predictions by time
  for (const [, monthData] of byMonth) {
    for (const date of Object.keys(monthData)) {
      monthData[date].sort((a, b) => {
        const [ah, am] = a.time.split(':').map(Number);
        const [bh, bm] = b.time.split(':').map(Number);
        return (ah * 60 + am) - (bh * 60 + bm);
      });
    }
  }

  return byMonth;
}

/**
 * Pack predictions into compact string format
 * Format: "HH:MM,f|e|s,velocity,direction|..."
 */
function packPredictions(predictions: CurrentPrediction[]): string {
  if (!predictions || predictions.length === 0) return '';

  return predictions.map(p => {
    const typeChar = p.type === 'flood' ? 'f' : p.type === 'ebb' ? 'e' : 's';
    return `${p.time},${typeChar},${p.velocity},${p.direction}`;
  }).join('|');
}

/**
 * Process a single station - fetch all months and save in packed format
 */
async function processStation(
  station: CurrentsJobStation,
  startDate: Date,
  endDate: Date
): Promise<{ success: boolean; monthsSaved: number; error?: string }> {
  try {
    const allMonthlyData = new Map<string, Record<string, CurrentPrediction[]>>();

    // Fetch month by month (NOAA has 31-day limit)
    let currentDate = new Date(startDate);

    while (currentDate < endDate) {
      const monthStart = new Date(currentDate);
      const monthEnd = new Date(currentDate);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      monthEnd.setDate(0); // Last day of month

      if (monthEnd > endDate) {
        monthEnd.setTime(endDate.getTime());
      }

      const predictions = await fetchCurrentPredictions(
        station.noaaId,
        station.bin,
        monthStart,
        monthEnd
      );

      if (predictions.length > 0) {
        const monthData = organizeByMonth(predictions);
        for (const [month, data] of monthData) {
          if (!allMonthlyData.has(month)) {
            allMonthlyData.set(month, {});
          }
          Object.assign(allMonthlyData.get(month)!, data);
        }
      }

      // Move to next month
      currentDate.setMonth(currentDate.getMonth() + 1);
      currentDate.setDate(1);

      // Rate limit: 500ms between NOAA API calls
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (allMonthlyData.size === 0) {
      return { success: false, monthsSaved: 0, error: 'No data from NOAA' };
    }

    // Calculate flood/ebb directions from sample data
    const sampleMonth = allMonthlyData.values().next().value;
    const sampleDays = Object.values(sampleMonth || {}).flat();
    const floods = sampleDays.filter((p: CurrentPrediction) => p.type === 'flood');
    const ebbs = sampleDays.filter((p: CurrentPrediction) => p.type === 'ebb');

    const floodDir = floods.length > 0
      ? Math.round(floods.reduce((sum, p) => sum + p.direction, 0) / floods.length)
      : 0;
    const ebbDir = ebbs.length > 0
      ? Math.round(ebbs.reduce((sum, p) => sum + p.direction, 0) / ebbs.length)
      : 180;

    const timestamp = admin.firestore.FieldValue.serverTimestamp();

    // Save station metadata
    await db.collection(CURRENTS_COLLECTION).doc(station.id).set({
      id: station.id,
      name: station.name,
      latitude: station.lat,
      longitude: station.lng,
      timeZone: 'America/Anchorage',
      floodDirection: floodDir,
      ebbDirection: ebbDir,
      noaaId: station.noaaId,
      type: 'harmonic',
      bin: station.bin,
      depth: station.depth,
      depthType: station.depthType,
      baseStationId: station.baseStationId,
      predictionRange: {
        begin: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
      },
      monthsAvailable: Array.from(allMonthlyData.keys()).sort(),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    // Save monthly predictions in PACKED format
    let monthsSaved = 0;
    for (const [monthKey, daysData] of allMonthlyData) {
      const packedDays: Record<number, string> = {};
      for (const [dateStr, preds] of Object.entries(daysData)) {
        const dayNum = parseInt(dateStr.split('-')[2], 10);
        packedDays[dayNum] = packPredictions(preds);
      }

      await db.collection(CURRENTS_COLLECTION).doc(station.id)
        .collection('predictions').doc(monthKey).set({
          month: monthKey,
          d: packedDays,
          dayCount: Object.keys(packedDays).length,
          updatedAt: timestamp,
        });
      monthsSaved++;
    }

    return { success: true, monthsSaved };
  } catch (err: any) {
    return { success: false, monthsSaved: 0, error: err.message };
  }
}

/**
 * TEST BATCH - Populate a small number of stations for testing
 */
export const populateCurrentsTestBatch = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '1GB',
  })
  .https.onCall(async (data, context) => {
    const stationCount = data.stationCount || 5;
    console.log(`Starting test batch: ${stationCount} stations`);

    // Get stations from existing catalog
    const catalogDoc = await db.collection(CURRENTS_COLLECTION).doc('catalog').get();
    if (!catalogDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'No current-stations-packed catalog found');
    }

    const catalog = catalogDoc.data()!;
    const allStations = catalog.stations || [];

    if (allStations.length === 0) {
      throw new functions.https.HttpsError('not-found', 'No stations in catalog');
    }

    // Take first N stations
    const stationsToProcess = allStations.slice(0, stationCount);

    // Calculate date range: 1 year ago to 2 years from now
    const now = new Date();
    const startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1);
    startDate.setDate(1);

    const endDate = new Date(now);
    endDate.setFullYear(endDate.getFullYear() + 2);
    endDate.setMonth(endDate.getMonth() + 1);
    endDate.setDate(0);

    console.log(`Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

    const results: any[] = [];

    for (const station of stationsToProcess) {
      console.log(`Processing ${station.id} (${station.name})...`);

      const stationData: CurrentsJobStation = {
        id: station.id,
        name: station.name,
        noaaId: station.noaaId || station.id.toUpperCase().replace(/_BIN\d+$/, ''),
        lat: station.latitude,
        lng: station.longitude,
        bin: station.bin || 1,
        depth: station.depth || null,
        depthType: station.depthType || 'surface',
        baseStationId: station.baseStationId || station.id.replace(/_bin\d+$/, ''),
      };

      const result = await processStation(stationData, startDate, endDate);
      results.push({
        id: station.id,
        name: station.name,
        ...result,
      });

      if (result.success) {
        console.log(`  ✓ ${result.monthsSaved} months saved`);
      } else {
        console.log(`  ✗ ${result.error}`);
      }

      // Rate limit: 2 seconds between stations
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`\nTest batch complete: ${successful} successful, ${failed} failed`);

    return {
      success: true,
      processed: results.length,
      successful,
      failed,
      results,
    };
  });

/**
 * START CURRENTS JOB - Creates job and publishes first batch
 */
export const startCurrentsJob = functions
  .runWith({
    timeoutSeconds: 60,
    memory: '256MB',
  })
  .https.onCall(async (data, context) => {
    const batchSize = data.batchSize || 10;
    
    console.log('Starting currents population job...');
    
    // Get stations from existing catalog
    const catalogDoc = await db.collection(CURRENTS_COLLECTION).doc('catalog').get();
    if (!catalogDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'No current-stations-packed catalog found');
    }
    
    const catalog = catalogDoc.data()!;
    const allStations = catalog.stations || [];
    
    if (allStations.length === 0) {
      throw new functions.https.HttpsError('not-found', 'No stations in catalog');
    }
    
    // Calculate date range
    const now = new Date();
    const startDate = new Date(now);
    startDate.setFullYear(startDate.getFullYear() - 1);
    startDate.setDate(1);
    
    const endDate = new Date(now);
    endDate.setFullYear(endDate.getFullYear() + 2);
    endDate.setMonth(endDate.getMonth() + 1);
    endDate.setDate(0);
    
    const totalBatches = Math.ceil(allStations.length / batchSize);
    const jobId = `currents-${Date.now()}`;
    
    // Create job document
    const jobRef = db.collection('system').doc('currents-jobs').collection('jobs').doc(jobId);
    await jobRef.set({
      jobId,
      status: 'running',
      config: {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        batchSize,
        totalStations: allStations.length,
        totalBatches,
      },
      progress: {
        batchesCompleted: 0,
        stationsProcessed: 0,
        stationsFailed: 0,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      startedAt: new Date().toISOString(),
    });
    
    // Create batch documents
    for (let i = 0; i < totalBatches; i++) {
      const batchStations = allStations.slice(i * batchSize, (i + 1) * batchSize);
      await jobRef.collection('batches').doc(`batch-${i}`).set({
        batchIndex: i,
        status: 'pending',
        stations: batchStations.map((s: any) => ({
          id: s.id,
          name: s.name,
          noaaId: s.noaaId || s.id.toUpperCase().replace(/_BIN\d+$/i, ''),
          lat: s.latitude,
          lng: s.longitude,
          bin: s.bin || 1,
          depth: s.depth || null,
          depthType: s.depthType || 'surface',
          baseStationId: s.baseStationId || s.id.replace(/_bin\d+$/i, ''),
        })),
      });
    }
    
    // Publish first batch to Pub/Sub
    const { PubSub } = require('@google-cloud/pubsub');
    const pubsub = new PubSub();
    
    const message = {
      jobId,
      batchIndex: 0,
    };
    
    await pubsub.topic(CURRENTS_BATCH_TOPIC).publishMessage({
      data: Buffer.from(JSON.stringify(message)),
    });
    
    console.log(`Job ${jobId} started with ${totalBatches} batches`);
    
    return {
      success: true,
      jobId,
      totalStations: allStations.length,
      totalBatches,
      dateRange: {
        start: startDate.toISOString().split('T')[0],
        end: endDate.toISOString().split('T')[0],
      },
    };
  });

/**
 * PROCESS CURRENTS BATCH - Pub/Sub triggered batch processor
 */
export const processCurrentsBatch = functions
  .runWith({
    timeoutSeconds: 540,
    memory: '1GB',
  })
  .pubsub.topic(CURRENTS_BATCH_TOPIC)
  .onPublish(async (message) => {
    const { jobId, batchIndex } = message.json;
    
    console.log(`Processing batch ${batchIndex} for job ${jobId}`);
    
    const jobRef = db.collection('system').doc('currents-jobs').collection('jobs').doc(jobId);
    const jobDoc = await jobRef.get();
    
    if (!jobDoc.exists) {
      console.error(`Job ${jobId} not found`);
      return;
    }
    
    const job = jobDoc.data() as CurrentsJob;
    
    // Check if job was cancelled
    if (job.status === 'cancelled') {
      console.log(`Job ${jobId} was cancelled, skipping batch ${batchIndex}`);
      return;
    }
    
    // Get batch
    const batchDoc = await jobRef.collection('batches').doc(`batch-${batchIndex}`).get();
    if (!batchDoc.exists) {
      console.error(`Batch ${batchIndex} not found`);
      return;
    }
    
    const batch = batchDoc.data()!;
    const stations = batch.stations as CurrentsJobStation[];
    
    // IDEMPOTENCY CHECK: Skip if batch was already processed or is currently processing
    if (batch.status === 'completed') {
      console.log(`Batch ${batchIndex} already completed, skipping (Pub/Sub duplicate delivery)`);
      return;
    }
    
    if (batch.status === 'processing') {
      // Check if it's been processing for too long (stale) - allow retry after 10 minutes
      const startedAt = batch.startedAt ? new Date(batch.startedAt) : null;
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      
      if (startedAt && startedAt > tenMinutesAgo) {
        console.log(`Batch ${batchIndex} is currently being processed by another instance, skipping`);
        return;
      }
      console.log(`Batch ${batchIndex} was processing but appears stale, retrying...`);
    }
    
    // Mark batch as processing
    await batchDoc.ref.update({ status: 'processing', startedAt: new Date().toISOString() });
    
    const startDate = new Date(job.config.startDate);
    const endDate = new Date(job.config.endDate);
    
    let processed = 0;
    let failed = 0;
    
    for (const station of stations) {
      console.log(`  Processing ${station.id}...`);
      
      const result = await processStation(station, startDate, endDate);
      
      if (result.success) {
        processed++;
        console.log(`    ✓ ${result.monthsSaved} months`);
      } else {
        failed++;
        console.log(`    ✗ ${result.error}`);
      }
      
      // Rate limit: 2 seconds between stations
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Update batch status
    await batchDoc.ref.update({
      status: 'completed',
      completedAt: new Date().toISOString(),
      results: { processed, failed },
    });
    
    // Update job progress
    await jobRef.update({
      'progress.batchesCompleted': admin.firestore.FieldValue.increment(1),
      'progress.stationsProcessed': admin.firestore.FieldValue.increment(processed),
      'progress.stationsFailed': admin.firestore.FieldValue.increment(failed),
    });
    
    // Check if there are more batches
    const nextBatchIndex = batchIndex + 1;
    if (nextBatchIndex < job.config.totalBatches) {
      // Re-check job status before triggering next batch
      const updatedJobDoc = await jobRef.get();
      const updatedJob = updatedJobDoc.data() as CurrentsJob;
      
      if (updatedJob.status === 'cancelled') {
        console.log(`Job ${jobId} was cancelled, not triggering next batch`);
        return;
      }
      
      // Publish next batch
      const { PubSub } = require('@google-cloud/pubsub');
      const pubsub = new PubSub();
      
      await pubsub.topic(CURRENTS_BATCH_TOPIC).publishMessage({
        data: Buffer.from(JSON.stringify({ jobId, batchIndex: nextBatchIndex })),
      });
      
      console.log(`Triggered batch ${nextBatchIndex}`);
    } else {
      // Job complete
      await jobRef.update({
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      console.log(`Job ${jobId} completed!`);
    }
  });

/**
 * GET CURRENTS JOB STATUS
 */
export const getCurrentsJobStatus = functions
  .runWith({ memory: '256MB' })
  .https.onCall(async (data, context) => {
    const { jobId } = data;
    
    if (!jobId) {
      // Return list of recent jobs
      const jobsSnap = await db.collection('system').doc('currents-jobs')
        .collection('jobs')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();
      
      return {
        jobs: jobsSnap.docs.map(doc => {
          const job = doc.data() as CurrentsJob;
          return {
            jobId: job.jobId,
            status: job.status,
            progress: job.progress,
            config: job.config,
            createdAt: job.createdAt?.toDate?.()?.toISOString(),
          };
        }),
      };
    }
    
    const jobDoc = await db.collection('system').doc('currents-jobs')
      .collection('jobs').doc(jobId).get();
    
    if (!jobDoc.exists) {
      throw new functions.https.HttpsError('not-found', `Job ${jobId} not found`);
    }
    
    const job = jobDoc.data() as CurrentsJob;
    
    return {
      jobId: job.jobId,
      status: job.status,
      config: job.config,
      progress: job.progress,
      createdAt: job.createdAt?.toDate?.()?.toISOString(),
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  });

/**
 * CANCEL CURRENTS JOB
 */
export const cancelCurrentsJob = functions
  .runWith({ memory: '256MB' })
  .https.onCall(async (data, context) => {
    const { jobId } = data;
    
    if (!jobId) {
      throw new functions.https.HttpsError('invalid-argument', 'jobId is required');
    }
    
    const jobRef = db.collection('system').doc('currents-jobs').collection('jobs').doc(jobId);
    const jobDoc = await jobRef.get();
    
    if (!jobDoc.exists) {
      throw new functions.https.HttpsError('not-found', `Job ${jobId} not found`);
    }
    
    await jobRef.update({
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
    });
    
    console.log(`Job ${jobId} cancelled`);
    
    return { success: true, jobId };
  });

// ============================================================================
// LIVE BUOYS - Hourly Update (NOAA NDBC)
// ============================================================================

const NDBC_REALTIME_URL = 'https://www.ndbc.noaa.gov/data/realtime2';
const NDBC_LATEST_OBS_URL = 'https://www.ndbc.noaa.gov/data/latest_obs';

// Axios instance for NDBC with SSL handling
const ndbcAxios = axios.create({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
  timeout: 15000,
});

/**
 * Fetch real-time observations for a buoy station
 * Tries multiple data sources for reliability
 */
async function fetchBuoyObservations(stationId: string): Promise<any | null> {
  const idsToTry = [stationId, stationId.toUpperCase(), stationId.toLowerCase()];
  const uniqueIds = [...new Set(idsToTry)];
  
  // Try realtime2 format first (standard buoys)
  for (const id of uniqueIds) {
    try {
      const url = `${NDBC_REALTIME_URL}/${id}.txt`;
      const response = await ndbcAxios.get(url);
      
      const lines = response.data.split('\n');
      if (lines.length < 3) continue;
      if (response.data.includes('<!DOCTYPE')) continue;
      
      const headers = lines[0].replace('#', '').trim().split(/\s+/);
      const dataLine = lines[2].trim().split(/\s+/);
      
      if (dataLine.length < 5) continue;
      
      const getValue = (header: string): number | undefined => {
        const idx = headers.indexOf(header);
        if (idx === -1 || idx >= dataLine.length) return undefined;
        const val = parseFloat(dataLine[idx]);
        return isNaN(val) || val === 99 || val === 999 || val === 9999 ? undefined : val;
      };
      
      // Build timestamp from date components
      const year = dataLine[0];
      const month = dataLine[1];
      const day = dataLine[2];
      const hour = dataLine[3];
      const minute = dataLine[4];
      const timestamp = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00Z`;
      
      // Build observation object, filtering out undefined values
      const observation: Record<string, any> = {
        timestamp,
      };
      
      // Only add defined values
      const windDirection = getValue('WDIR');
      if (windDirection !== undefined) observation.windDirection = windDirection;
      
      const windSpeed = getValue('WSPD');
      if (windSpeed !== undefined) observation.windSpeed = windSpeed;
      
      const windGust = getValue('GST');
      if (windGust !== undefined) observation.windGust = windGust;
      
      const waveHeight = getValue('WVHT');
      if (waveHeight !== undefined) observation.waveHeight = waveHeight;
      
      const dominantWavePeriod = getValue('DPD');
      if (dominantWavePeriod !== undefined) observation.dominantWavePeriod = dominantWavePeriod;
      
      const averageWavePeriod = getValue('APD');
      if (averageWavePeriod !== undefined) observation.averageWavePeriod = averageWavePeriod;
      
      const meanWaveDirection = getValue('MWD');
      if (meanWaveDirection !== undefined) observation.meanWaveDirection = meanWaveDirection;
      
      const pressure = getValue('PRES');
      if (pressure !== undefined) observation.pressure = pressure;
      
      const airTemp = getValue('ATMP');
      if (airTemp !== undefined) observation.airTemp = airTemp;
      
      const waterTemp = getValue('WTMP');
      if (waterTemp !== undefined) observation.waterTemp = waterTemp;
      
      const dewPoint = getValue('DEWP');
      if (dewPoint !== undefined) observation.dewPoint = dewPoint;
      
      const visibility = getValue('VIS');
      if (visibility !== undefined) observation.visibility = visibility;
      
      const pressureTendency = getValue('PTDY');
      if (pressureTendency !== undefined) observation.pressureTendency = pressureTendency;
      
      const tide = getValue('TIDE');
      if (tide !== undefined) observation.tide = tide;
      
      return observation;
    } catch (error) {
      // Continue to next attempt
    }
  }
  
  // Try latest_obs format as fallback
  for (const id of uniqueIds) {
    try {
      const url = `${NDBC_LATEST_OBS_URL}/${id}.txt`;
      const response = await ndbcAxios.get(url);
      
      if (response.data.includes('<!DOCTYPE')) continue;
      
      const lines = response.data.split('\n');
      const data: Record<string, string> = {};
      
      for (const line of lines) {
        const match = line.match(/^([^:]+):\s*(.+)$/);
        if (match) {
          data[match[1].trim()] = match[2].trim();
        }
      }
      
      if (Object.keys(data).length < 3) continue;
      
      const parseValue = (str: string | undefined): number | undefined => {
        if (!str) return undefined;
        const num = parseFloat(str.split(' ')[0]);
        return isNaN(num) ? undefined : num;
      };
      
      // Build observation object, filtering out undefined values
      const observation: Record<string, any> = {
        timestamp: new Date().toISOString(),
      };
      
      // Only add defined values
      const windSpeed = parseValue(data['Wind']);
      if (windSpeed !== undefined) observation.windSpeed = windSpeed;
      
      const windGust = parseValue(data['Gust']);
      if (windGust !== undefined) observation.windGust = windGust;
      
      const waveHeight = parseValue(data['Wave Height']);
      if (waveHeight !== undefined) observation.waveHeight = waveHeight;
      
      const dominantWavePeriod = parseValue(data['Dominant Wave Period']);
      if (dominantWavePeriod !== undefined) observation.dominantWavePeriod = dominantWavePeriod;
      
      const pressure = parseValue(data['Pressure']);
      if (pressure !== undefined) observation.pressure = pressure;
      
      const airTemp = parseValue(data['Air Temp']);
      if (airTemp !== undefined) observation.airTemp = airTemp;
      
      const waterTemp = parseValue(data['Water Temp']);
      if (waterTemp !== undefined) observation.waterTemp = waterTemp;
      
      return observation;
    } catch (error) {
      // Continue to next attempt
    }
  }
  
  return null;
}

/**
 * UPDATE BUOY DATA (Scheduled)
 * Fetches latest observations from NOAA/NDBC buoys hourly
 */
export const updateBuoyData = functions
  .runWith({ 
    timeoutSeconds: 120,
    memory: '256MB',
  })
  .pubsub.schedule('15 * * * *') // Every hour at :15
  .timeZone('America/Anchorage')
  .onRun(async (context) => {
    console.log('Starting hourly buoy data update...');
    const skippedBuoys: string[] = [];

    try {
      const catalogDoc = await db.collection('buoys').doc('catalog').get();
      
      if (!catalogDoc.exists) {
        console.log('No buoys catalog found');
        return null;
      }

      const catalog = catalogDoc.data()!;
      const stations = catalog.stations as Array<{ id: string; name: string }>;
      
      console.log(`Updating ${stations.length} buoys...`);

      let successCount = 0;
      let skipCount = 0;

      for (const station of stations) {
        const obs = await fetchBuoyObservations(station.id);
        
        if (obs) {
          await db.collection('buoys').doc(station.id).update({
            latestObservation: obs,
            lastUpdated: new Date().toISOString(),
          });
          successCount++;
        } else {
          skipCount++;
          skippedBuoys.push(station.name || station.id);
        }
        
        // Small delay to avoid rate limiting
        await delay(50);
      }

      // Update catalog timestamp
      await db.collection('buoys').doc('catalog').update({
        lastUpdated: new Date().toISOString(),
      });

      console.log(`Buoy update complete: ${successCount} updated, ${skipCount} skipped`);
      
      // Log to daily issues tracker if there were problems
      if (skipCount > 0 || successCount === 0) {
        const today = new Date().toISOString().split('T')[0];
        const issueRef = db.collection('system').doc('buoy-daily-issues');
        
        await issueRef.set({
          [today]: admin.firestore.FieldValue.arrayUnion({
            timestamp: new Date().toISOString(),
            successCount,
            skipCount,
            skippedBuoys,
            totalBuoys: stations.length,
          })
        }, { merge: true });
      }
      
      return null;
    } catch (error: any) {
      console.error('Error updating buoy data:', error);
      
      const today = new Date().toISOString().split('T')[0];
      const issueRef = db.collection('system').doc('buoy-daily-issues');
      
      await issueRef.set({
        [today]: admin.firestore.FieldValue.arrayUnion({
          timestamp: new Date().toISOString(),
          error: error.message || 'Unknown error',
          type: 'failure',
        })
      }, { merge: true });
      
      return null;
    }
  });

/**
 * DAILY BUOY SUMMARY (Scheduled)
 * Sends summary email at midnight if there were issues
 */
export const dailyBuoySummary = functions
  .runWith({ 
    timeoutSeconds: 60,
    memory: '256MB',
  })
  .pubsub.schedule('0 0 * * *') // Every day at midnight
  .timeZone('America/Anchorage')
  .onRun(async (context) => {
    console.log('Running daily buoy summary check...');
    
    try {
      const issueRef = db.collection('system').doc('buoy-daily-issues');
      const issueDoc = await issueRef.get();
      
      if (!issueDoc.exists) {
        console.log('No buoy issues document found, nothing to report');
        return null;
      }
      
      const issueData = issueDoc.data() || {};
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = yesterday.toISOString().split('T')[0];
      
      const yesterdayIssues = issueData[yesterdayKey] || [];
      
      if (yesterdayIssues.length === 0) {
        console.log('No buoy issues yesterday, no email needed');
      } else {
        let totalSkipped = 0;
        let totalSuccess = 0;
        let totalFailures = 0;
        const allSkippedBuoys = new Set<string>();
        
        for (const issue of yesterdayIssues) {
          if (issue.type === 'failure') {
            totalFailures++;
          } else {
            totalSkipped += issue.skipCount || 0;
            totalSuccess += issue.successCount || 0;
            (issue.skippedBuoys || []).forEach((b: string) => allSkippedBuoys.add(b));
          }
        }
        
        if (totalFailures > 0 || totalSkipped > 0) {
          const startTime = new Date();
          await sendJobNotification({
            functionName: 'Daily Buoy Summary',
            status: totalFailures > 0 ? 'failed' : 'partial',
            startTime,
            endTime: new Date(),
            details: {
              'Date': yesterdayKey,
              'Hourly Runs with Issues': yesterdayIssues.length,
              'Total Updates Successful': totalSuccess,
              'Total Updates Skipped': totalSkipped,
              'Complete Failures': totalFailures,
              'Buoys with Issues': allSkippedBuoys.size > 0 
                ? Array.from(allSkippedBuoys).slice(0, 10).join(', ') + (allSkippedBuoys.size > 10 ? '...' : '')
                : 'None',
            }
          });
          console.log(`Sent daily buoy summary: ${totalSkipped} skipped, ${totalFailures} failures`);
        } else {
          console.log('All buoy updates were successful yesterday, no email needed');
        }
      }
      
      // Clean up old issue logs (older than 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const keysToDelete: string[] = [];
      for (const key of Object.keys(issueData)) {
        if (key < sevenDaysAgo.toISOString().split('T')[0]) {
          keysToDelete.push(key);
        }
      }
      
      if (keysToDelete.length > 0) {
        const deleteUpdates: Record<string, any> = {};
        keysToDelete.forEach(key => {
          deleteUpdates[key] = admin.firestore.FieldValue.delete();
        });
        await issueRef.update(deleteUpdates);
        console.log(`Cleaned up ${keysToDelete.length} old buoy issue logs`);
      }
      
      return null;
    } catch (error: any) {
      console.error('Error in daily buoy summary:', error);
      return null;
    }
  });

/**
 * TRIGGER BUOY UPDATE (Manual)
 * Callable function to force immediate buoy data refresh
 */
export const triggerBuoyUpdate = functions.https.onCall(async (data, context) => {
  console.log('Manual buoy update triggered...');

  try {
    const catalogDoc = await db.collection('buoys').doc('catalog').get();
    
    if (!catalogDoc.exists) {
      return { success: false, message: 'No buoys catalog found' };
    }

    const catalog = catalogDoc.data()!;
    const stations = catalog.stations as Array<{ id: string; name: string }>;

    let successCount = 0;
    let skipCount = 0;

    for (const station of stations) {
      const obs = await fetchBuoyObservations(station.id);
      
      if (obs) {
        await db.collection('buoys').doc(station.id).update({
          latestObservation: obs,
          lastUpdated: new Date().toISOString(),
        });
        successCount++;
      } else {
        skipCount++;
      }
      
      await delay(50);
    }

    await db.collection('buoys').doc('catalog').update({
      lastUpdated: new Date().toISOString(),
    });

    return {
      success: true,
      message: `Updated ${successCount} buoys, skipped ${skipCount}`,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('Error in manual buoy update:', error);
    return { success: false, message: error.message };
  }
});

// ============================================================================
// MARINE WEATHER FORECASTS - Smart Polling (NWS)
// ============================================================================

const MARINE_WEATHER_URL = 'https://marine.weather.gov/MapClick.php?zoneid=';

/**
 * Fetch and parse forecast for a single zone from marine.weather.gov
 */
async function fetchZoneForecast(zoneId: string): Promise<any> {
  const url = `${MARINE_WEATHER_URL}${zoneId.toLowerCase()}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; XNauticalBot/1.0)',
        'Accept': 'text/html'
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(response.data);
    
    // Get zone name from h1
    let zoneName = $('h1').first().text().trim();
    if (!zoneName || zoneName.includes('location') || zoneName.includes('Sorry')) {
      zoneName = zoneId;
    }
    
    // Get the forecast panel
    const forecastPanel = $('#detailed-forecast-body');
    if (!forecastPanel.length) {
      return { error: 'No forecast panel found' };
    }
    
    // Get the full text content
    const fullText = forecastPanel.text().replace(/\s+/g, ' ').trim();
    
    if (!fullText || fullText.length < 20) {
      return { error: 'No forecast text found' };
    }
    
    // Parse out advisory
    let advisory = '';
    const advisoryMatch = fullText.match(/\.\.\.([^.]+)\.\.\./);
    if (advisoryMatch) {
      advisory = advisoryMatch[1].trim();
    }
    
    // Parse out synopsis
    let synopsis = '';
    const synopsisMatch = fullText.match(/Synopsis:\s*(.+?)(?=Today|Tonight|Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i);
    if (synopsisMatch) {
      synopsis = synopsisMatch[1].trim();
    }
    
    // Parse forecast periods from the forecast rows
    const periods: Array<{number: number; name: string; detailedForecast: string}> = [];
    let periodNum = 1;
    
    forecastPanel.find('.row-forecast').each((i: number, el: any) => {
      const periodName = $(el).find('.forecast-label b').text().trim() || 
                         $(el).find('b').first().text().trim();
      const forecastText = $(el).find('.forecast-text').text().replace(/\s+/g, ' ').trim();
      
      if (periodName && forecastText && forecastText.length > 5) {
        periods.push({
          number: periodNum++,
          name: periodName,
          detailedForecast: forecastText
        });
      }
    });
    
    // Get last update time
    const updateText = $('b:contains("Last Update")').parent().text();
    const updateMatch = updateText.match(/Last Update:\s*(.+)/i);
    const lastUpdate = updateMatch ? updateMatch[1].trim() : new Date().toISOString();
    
    if (periods.length === 0) {
      return { error: 'No forecast periods found' };
    }
    
    return {
      zoneName,
      advisory,
      synopsis,
      periods,
      updated: lastUpdate,
    };
  } catch (error: any) {
    console.log(`Error fetching ${zoneId}:`, error.message);
    return { error: error.message };
  }
}

/**
 * Fetch all marine forecasts for a specific district from marine.weather.gov
 */
async function fetchAllMarineForecastsForDistrict(districtId: string): Promise<Record<string, any>> {
  const zonesSnap = await db.collection('marine-forecast-districts').doc(districtId)
    .collection('marine-zones').get();
  const zones: Array<{id: string; name?: string}> = [];
  
  zonesSnap.forEach(doc => {
    zones.push({ id: doc.id, ...doc.data() as any });
  });
  
  console.log(`[${districtId}] Found ${zones.length} marine zones`);
  
  const forecasts: Record<string, any> = {};
  let successCount = 0;
  
  for (const zone of zones) {
    const forecast = await fetchZoneForecast(zone.id);
    
    if (!forecast.error) {
      forecasts[zone.id] = {
        ...forecast,
        zoneName: zone.name || forecast.zoneName
      };
      successCount++;
    }
    
    await delay(300);
  }
  
  console.log(`[${districtId}] Successfully fetched ${successCount}/${zones.length} forecasts`);
  
  return forecasts;
}

/**
 * Save forecasts to Firebase for a specific district
 */
async function saveMarineForecastsForDistrict(districtId: string, forecasts: Record<string, any>): Promise<number> {
  let count = 0;
  
  for (const [zoneId, forecast] of Object.entries(forecasts)) {
    try {
      await db.collection('marine-forecast-districts').doc(districtId)
        .collection('marine-forecasts').doc(zoneId).set({
        zoneId: zoneId,
        zoneName: forecast.zoneName || zoneId,
        advisory: forecast.advisory || '',
        synopsis: forecast.synopsis || '',
        forecast: forecast.periods,
        nwsUpdated: forecast.updated,
        districtId: districtId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      count++;
    } catch (error: any) {
      console.error(`[${districtId}] Error saving ${zoneId}:`, error.message);
    }
  }
  
  return count;
}

// District timezone configuration
const DISTRICT_TIMEZONES: Record<string, string> = {
  '01cgd': 'America/New_York',      // Northeast
  '05cgd': 'America/New_York',      // East
  '07cgd': 'America/New_York',      // Southeast
  '08cgd': 'America/Chicago',       // Heartland
  '09cgd': 'America/Chicago',       // Great Lakes
  '11cgd': 'America/Los_Angeles',   // Southwest
  '13cgd': 'America/Los_Angeles',   // Northwest
  '14cgd': 'Pacific/Honolulu',      // Oceania
  '17cgd': 'America/Anchorage',     // Arctic (Alaska)
};

// NWS marine forecast update times (in local timezone)
// NWS updates forecasts between 3-4 AM and 3-4 PM local time
// We start checking at 3:30 AM/PM and continue until 4:30 AM/PM or until all zones are retrieved
const NWS_UPDATE_HOURS = [3, 15]; // 3 AM and 3 PM local time (start of update window)

/**
 * Check if we should be polling for updates for a specific district right now
 * NWS updates marine forecasts between 3-4 AM and 3-4 PM in the district's local time
 * We check from 3:30 AM/PM to 4:30 AM/PM (30 min after window starts, continues 30 min after window ends)
 * @param districtId Optional district ID. If not provided, checks Alaska (17cgd) for backward compatibility
 */
function isInMarineUpdateWindow(districtId?: string): { inWindow: boolean; windowHour?: number; minutesSinceStart?: number } {
  const district = districtId || '17cgd';  // Default to Alaska for backward compatibility
  const timezone = DISTRICT_TIMEZONES[district] || 'America/Anchorage';
  const now = new Date();
  const localTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  const hour = localTime.getHours();
  const minute = localTime.getMinutes();
  const currentMinutes = hour * 60 + minute;
  
  for (const windowHour of NWS_UPDATE_HOURS) {
    const windowStart = windowHour * 60 + 30; // Start checking 30 min after window begins (3:30 AM/PM)
    const windowEnd = windowStart + 60; // Continue for 60 minutes (until 4:30 AM/PM)
    
    if (currentMinutes >= windowStart && currentMinutes < windowEnd) {
      return { inWindow: true, windowHour, minutesSinceStart: currentMinutes - (windowHour * 60) };
    }
  }
  
  return { inWindow: false };
}

/**
 * Get the last update info for a specific district
 * Returns both the timestamp and the number of zones updated
 * @param districtId Optional district ID. If not provided, checks global system collection for backward compatibility
 */
async function getMarineLastUpdateInfo(districtId?: string): Promise<{ timestamp: Date | null; zonesUpdated: number; totalZones: number; windowHour: number | null }> {
  let metaDoc;
  
  if (districtId) {
    metaDoc = await db.collection('marine-forecast-districts').doc(districtId)
      .collection('system').doc('marine-forecast-meta').get();
  } else {
    // Backward compatibility: check global system collection
    metaDoc = await db.collection('system').doc('marine-forecast-meta').get();
  }
  
  if (metaDoc.exists) {
    const data = metaDoc.data();
    return {
      timestamp: data?.lastUpdatedAt?.toDate() || null,
      zonesUpdated: data?.zonesUpdated || 0,
      totalZones: data?.totalZones || 0,
      windowHour: data?.windowHour || null
    };
  }
  return { timestamp: null, zonesUpdated: 0, totalZones: 0, windowHour: null };
}

/**
 * Save the last update info for a specific district
 * @param districtId Optional district ID. If not provided, saves to global system collection for backward compatibility
 */
async function saveMarineLastUpdateInfo(districtId: string | undefined, zonesUpdated: number, totalZones: number, windowHour: number): Promise<void> {
  if (districtId) {
    await db.collection('marine-forecast-districts').doc(districtId)
      .collection('system').doc('marine-forecast-meta').set({
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      zonesUpdated,
      totalZones,
      windowHour
    }, { merge: true });
  } else {
    // Backward compatibility: save to global system collection
    await db.collection('system').doc('marine-forecast-meta').set({
      lastUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      zonesUpdated,
      totalZones,
      windowHour
    }, { merge: true });
  }
}

/**
 * FETCH MARINE FORECASTS (Scheduled)
 * Runs every 15 minutes with smart polling during update windows
 * 
 * Update Strategy:
 * - NWS updates forecasts between 3-4 AM and 3-4 PM local time
 * - We start checking at 3:30 AM/PM (30 min after window starts)
 * - Continue checking every 15 minutes until 4:30 AM/PM OR until all zones retrieved
 * - Supports multiple districts with different timezones
 */
export const fetchMarineForecasts = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .pubsub
  .schedule('every 15 minutes')
  .timeZone('UTC')  // Use UTC as base timezone
  .onRun(async (context) => {
    // Active districts with marine zones
    const activeDistricts = ['17cgd', '07cgd'];  // Alaska and Southeast
    
    console.log('Checking marine forecast update windows for all districts...');
    
    const updates: Array<Promise<void>> = [];
    
    for (const districtId of activeDistricts) {
      const windowInfo = isInMarineUpdateWindow(districtId);
      
      if (!windowInfo.inWindow) {
        console.log(`[${districtId}] Not in update window, skipping`);
        continue;
      }
      
      console.log(`[${districtId}] In update window (${windowInfo.windowHour}:00), ${windowInfo.minutesSinceStart} min since start`);
      
      // Check if we already successfully retrieved all zones in this window
      const lastUpdate = await getMarineLastUpdateInfo(districtId);
      
      if (lastUpdate.timestamp && lastUpdate.windowHour === windowInfo.windowHour) {
        // We already updated during this window
        if (lastUpdate.zonesUpdated === lastUpdate.totalZones && lastUpdate.totalZones > 0) {
          console.log(`[${districtId}] Already retrieved all ${lastUpdate.totalZones} zones in this window, skipping`);
          continue;
        }
        
        // Partial update - check if we should retry
        const minutesSinceLastUpdate = (Date.now() - lastUpdate.timestamp.getTime()) / 60000;
        if (minutesSinceLastUpdate < 15) {
          console.log(`[${districtId}] Recently updated ${Math.round(minutesSinceLastUpdate)} minutes ago (${lastUpdate.zonesUpdated}/${lastUpdate.totalZones} zones), waiting for next interval`);
          continue;
        }
      }
      
      // Schedule update for this district
      updates.push(updateDistrictForecasts(districtId, windowInfo));
    }
    
    // Wait for all district updates to complete
    if (updates.length > 0) {
      await Promise.all(updates);
      console.log(`Completed ${updates.length} district update(s)`);
    } else {
      console.log('No districts needed updates');
    }
    
    return null;
  });

/**
 * Update forecasts for a single district
 */
async function updateDistrictForecasts(
  districtId: string, 
  windowInfo: { inWindow: boolean; windowHour?: number; minutesSinceStart?: number }
): Promise<void> {
  try {
    console.log(`[${districtId}] Fetching forecasts from marine.weather.gov...`);
    const forecasts = await fetchAllMarineForecastsForDistrict(districtId);
    
    const totalZones = Object.keys(forecasts).length;
    const count = await saveMarineForecastsForDistrict(districtId, forecasts);
    await saveMarineLastUpdateInfo(districtId, count, totalZones, windowInfo.windowHour!);
    
    if (count === totalZones && totalZones > 0) {
      console.log(`[${districtId}] ✓ Successfully retrieved all ${count}/${totalZones} marine zone forecasts`);
    } else {
      console.log(`[${districtId}] ⚠ Partial update: ${count}/${totalZones} marine zone forecasts`);
    }
    
    // Log to daily tracker if there were issues
    if (count === 0 || count < totalZones) {
      const today = new Date().toISOString().split('T')[0];
      const issueRef = db.collection('system').doc('marine-daily-issues');
      
      await issueRef.set({
        [today]: admin.firestore.FieldValue.arrayUnion({
          timestamp: new Date().toISOString(),
          districtId,
          zonesUpdated: count,
          totalZones,
          updateWindow: `${windowInfo.windowHour}:00`,
          type: count === 0 ? 'failure' : 'partial',
        })
      }, { merge: true });
    }
  } catch (error: any) {
    console.error(`[${districtId}] Error fetching marine forecasts:`, error);
    
    const today = new Date().toISOString().split('T')[0];
    const issueRef = db.collection('system').doc('marine-daily-issues');
    
    await issueRef.set({
      [today]: admin.firestore.FieldValue.arrayUnion({
        timestamp: new Date().toISOString(),
        districtId,
        error: error.message || 'Unknown error',
        type: 'failure',
      })
    }, { merge: true });
  }
}

/**
 * DAILY MARINE FORECAST SUMMARY (Scheduled)
 * Runs at midnight Alaska time to check for issues
 */
export const dailyMarineForecastSummary = functions
  .runWith({ 
    timeoutSeconds: 60,
    memory: '256MB',
  })
  .pubsub.schedule('0 0 * * *')
  .timeZone('America/Anchorage')
  .onRun(async (context) => {
    console.log('Running daily marine forecast summary check...');
    
    try {
      const issueRef = db.collection('system').doc('marine-daily-issues');
      const issueDoc = await issueRef.get();
      
      if (!issueDoc.exists) {
        console.log('No marine issues document found, nothing to report');
        return null;
      }
      
      const issueData = issueDoc.data() || {};
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = yesterday.toISOString().split('T')[0];
      
      const yesterdayIssues = issueData[yesterdayKey] || [];
      
      if (yesterdayIssues.length === 0) {
        console.log('No marine forecast issues yesterday, no email needed');
      } else {
        let failures = 0;
        for (const issue of yesterdayIssues) {
          if (issue.type === 'failure') failures++;
        }
        console.log(`Marine forecast issues yesterday: ${failures} failures, ${yesterdayIssues.length} total issues`);
      }
      
      // Clean up old issue logs (older than 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const keysToDelete: string[] = [];
      for (const key of Object.keys(issueData)) {
        if (key < sevenDaysAgo.toISOString().split('T')[0]) {
          keysToDelete.push(key);
        }
      }
      
      if (keysToDelete.length > 0) {
        const deleteUpdates: Record<string, any> = {};
        keysToDelete.forEach(key => {
          deleteUpdates[key] = admin.firestore.FieldValue.delete();
        });
        await issueRef.update(deleteUpdates);
        console.log(`Cleaned up ${keysToDelete.length} old marine issue logs`);
      }
      
      return null;
    } catch (error: any) {
      console.error('Error in daily marine forecast summary:', error);
      return null;
    }
  });

/**
 * REFRESH MARINE FORECASTS (Manual HTTP Trigger)
 * Bypasses smart polling to immediately refresh all forecasts
 * Supports district parameter: /refreshMarineForecasts?district=07cgd
 * or all districts: /refreshMarineForecasts
 */
export const refreshMarineForecasts = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onRequest(async (req, res) => {
    try {
      const districtId = req.query.district as string | undefined;
      
      if (districtId) {
        console.log(`Manual marine forecast refresh triggered for district: ${districtId}`);
        
        const forecasts = await fetchAllMarineForecastsForDistrict(districtId);
        const totalZones = Object.keys(forecasts).length;
        const count = await saveMarineForecastsForDistrict(districtId, forecasts);
        
        // Save with current hour as window (for manual refresh tracking)
        const now = new Date();
        const timezone = DISTRICT_TIMEZONES[districtId] || 'America/New_York';
        const localTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
        const currentHour = localTime.getHours();
        
        await saveMarineLastUpdateInfo(districtId, count, totalZones, currentHour);
        
        console.log(`Manual refresh complete for ${districtId}: ${count} zones updated`);
        
        res.json({
          success: true,
          districtId,
          forecastsUpdated: count,
          totalZonesFetched: totalZones,
        });
      } else {
        console.log('Manual marine forecast refresh triggered for all districts');
        
        const activeDistricts = ['17cgd', '07cgd'];  // Alaska and Southeast
        const results = [];
        
        for (const district of activeDistricts) {
          const forecasts = await fetchAllMarineForecastsForDistrict(district);
          const totalZones = Object.keys(forecasts).length;
          const count = await saveMarineForecastsForDistrict(district, forecasts);
          
          // Save with current hour as window (for manual refresh tracking)
          const now = new Date();
          const timezone = DISTRICT_TIMEZONES[district] || 'America/New_York';
          const localTime = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
          const currentHour = localTime.getHours();
          
          await saveMarineLastUpdateInfo(district, count, totalZones, currentHour);
          
          results.push({
            districtId: district,
            forecastsUpdated: count,
            totalZonesFetched: totalZones,
          });
          
          console.log(`Refreshed ${district}: ${count} zones updated`);
        }
        
        res.json({
          success: true,
          districts: results,
        });
      }
    } catch (error: any) {
      console.error('Error in manual marine forecast refresh:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

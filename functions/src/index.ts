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
 * Environment Variables Required:
 *   - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER (SMS)
 *   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (Email)
 *   - NOTIFICATION_EMAIL (Admin notifications)
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import axios from 'axios';
import * as nodemailer from 'nodemailer';

// Load environment variables
require('dotenv').config();

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// ============================================================================
// TIDE & CURRENT STATION LOCATIONS
// ============================================================================

/**
 * Get all tide and current station locations (without predictions)
 * Returns compact JSON with just the metadata needed for map display
 */
export const getStationLocations = functions.https.onCall(async (data, context) => {
  try {
    console.log('Fetching station locations...');
    
    // Fetch both collections in parallel
    const [tideSnapshot, currentSnapshot] = await Promise.all([
      db.collection('tidal-stations').get(),
      db.collection('current-stations-packed').get(),
    ]);
    
    // Extract only the fields we need (no predictions!)
    const tideStations = tideSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || 'Unknown',
        lat: data.lat || 0,
        lng: data.lng || 0,
        type: data.type || 'S',
      };
    });
    
    const currentStations = currentSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name || 'Unknown',
        lat: data.lat || 0,
        lng: data.lng || 0,
        bin: data.bin || 0,
      };
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

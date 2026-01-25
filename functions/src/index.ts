/**
 * XNautical Cloud Functions
 * 
 * Handles SMS verification for phone number verification during sign up.
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

// Load environment variables
require('dotenv').config();

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

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

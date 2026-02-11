/**
 * Login Screen - Email/password authentication with phone verification
 * Styled similar to FishTopia AuthScreen
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  ScrollView,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from '../config/firebase';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  sendPasswordResetEmail 
} from '@react-native-firebase/auth';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  Mail,
  Lock,
  ArrowRight,
  CheckCircle,
  ChevronLeft,
  User as UserIcon,
  Eye,
  EyeOff,
  Phone,
  Shield,
  Check,
  Fingerprint,
  Scan,
} from 'lucide-react-native';

const REMEMBER_EMAIL_KEY = '@XNautical:rememberedEmail';
const BIOMETRIC_ENABLED_KEY = '@XNautical:biometricEnabled';
const BIOMETRIC_CREDENTIALS_KEY = '@XNautical:biometricCredentials';

// Colors matching XNautical branding
const colors = {
  navy800: '#1e3a5f',
  navy900: '#1a365d',
  gold400: '#d4a84b',
  gold600: '#b8942f',
  teal50: '#f0fdfa',
  teal600: '#0d9488',
  teal700: '#0f766e',
  slate50: '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate700: '#334155',
  slate800: '#1e293b',
  white: '#ffffff',
  red50: '#fef2f2',
  red600: '#dc2626',
  green100: '#dcfce7',
  green500: '#22c55e',
  green600: '#16a34a',
};

// Initialize Firebase Functions
const functions = getFunctions(app);

interface Props {
  onLoginSuccess: () => void;
}

type AuthMode = 'LOGIN' | 'SIGNUP' | 'VERIFY' | 'FORGOT';

export default function LoginScreen({ onLoginSuccess }: Props) {
  const [mode, setMode] = useState<AuthMode>('LOGIN');
  const [loading, setLoading] = useState(false);

  // Login State
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginError, setLoginError] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(false);

  // Signup State
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newPass, setNewPass] = useState('');
  const [signupError, setSignupError] = useState('');
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  // Verification State
  const [verificationCode, setVerificationCode] = useState('');
  const [verifyError, setVerifyError] = useState('');

  // Biometric State
  const [biometricSupported, setBiometricSupported] = useState(false);
  const [biometricType, setBiometricType] = useState<'fingerprint' | 'facial' | null>(null);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);

  // Forgot Password State
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    initAuth();
  }, []);

  const initAuth = async () => {
    try {
      // Check biometric support
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setBiometricSupported(compatible && enrolled);

      if (compatible && enrolled) {
        const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
        if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
          setBiometricType('facial');
        } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
          setBiometricType('fingerprint');
        }

        const biometricEnabledValue = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
        setBiometricEnabled(biometricEnabledValue === 'true');
      }

      // Load saved email
      const [savedRemember, savedEmail] = await Promise.all([
        AsyncStorage.getItem(REMEMBER_EMAIL_KEY),
        AsyncStorage.getItem(REMEMBER_EMAIL_KEY + '_value'),
      ]);
      if (savedRemember === 'true' && savedEmail) {
        setRememberEmail(true);
        setLoginEmail(savedEmail);
      }
    } catch (error) {
      console.error('Error initializing auth:', error);
    }
  };

  const formatPhoneNumber = (text: string) => {
    // Allow + at the start for international numbers
    const startsWithPlus = text.startsWith('+');
    const cleaned = text.replace(/[^\d]/g, '');
    
    // If it starts with +, it's international - minimal formatting
    if (startsWithPlus) {
      if (cleaned.length === 0) return '+';
      // Format: +X XXX XXX XXXX (flexible spacing)
      let formatted = '+' + cleaned.slice(0, 15); // Max 15 digits per E.164
      return formatted;
    }
    
    // US format for numbers without +
    if (cleaned.length <= 3) {
      return cleaned;
    } else if (cleaned.length <= 6) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
    } else {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
    }
  };

  const handlePhoneChange = (text: string) => {
    // Allow + character for international
    if (text === '+' || text.startsWith('+')) {
      setNewPhone(formatPhoneNumber(text));
    } else {
      setNewPhone(formatPhoneNumber(text));
    }
  };

  // Normalize phone number for API calls
  const normalizePhoneNumber = (phone: string): string => {
    const digits = phone.replace(/[^\d]/g, '');
    
    // If already has country code (starts with +)
    if (phone.startsWith('+')) {
      return '+' + digits;
    }
    
    // Assume US number if 10 digits without country code
    if (digits.length === 10) {
      return '+1' + digits;
    }
    
    // Return with + prefix for other cases
    return '+' + digits;
  };

  // Validate phone number
  const isValidPhoneNumber = (phone: string): boolean => {
    const digits = phone.replace(/[^\d]/g, '');
    // Minimum 10 digits (US) or up to 15 (international max per E.164)
    return digits.length >= 10 && digits.length <= 15;
  };

  const getFirebaseErrorMessage = (errorCode: string): string => {
    switch (errorCode) {
      case 'auth/invalid-email':
        return 'Invalid email address format.';
      case 'auth/user-disabled':
        return 'This account has been disabled.';
      case 'auth/user-not-found':
        return 'No account found with this email.';
      case 'auth/wrong-password':
        return 'Incorrect password.';
      case 'auth/invalid-credential':
        return 'Invalid email or password.';
      case 'auth/email-already-in-use':
        return 'An account with this email already exists.';
      case 'auth/weak-password':
        return 'Password should be at least 6 characters.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please try again later.';
      default:
        return 'An error occurred. Please try again.';
    }
  };

  const handleBiometricLogin = async () => {
    setBiometricLoading(true);
    setLoginError('');

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to login',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });

      if (result.success) {
        const credentialsJson = await AsyncStorage.getItem(BIOMETRIC_CREDENTIALS_KEY);
        if (credentialsJson) {
          const credentials = JSON.parse(credentialsJson);
          const authInstance = getAuth();
          await signInWithEmailAndPassword(authInstance, credentials.email, credentials.password);
          onAuthSuccess();
        } else {
          setLoginError('No saved credentials found. Please login with email and password.');
          setBiometricEnabled(false);
          await AsyncStorage.removeItem(BIOMETRIC_ENABLED_KEY);
        }
      }
    } catch (error: any) {
      console.error('Biometric login error:', error);
      setLoginError('Biometric authentication failed.');
    } finally {
      setBiometricLoading(false);
    }
  };

  const promptEnableBiometric = (email: string, password: string) => {
    if (!biometricSupported || biometricEnabled) return;

    Alert.alert(
      'Enable Biometrics?',
      'Would you like to use biometrics for faster login next time?',
      [
        { text: 'Not Now', style: 'cancel' },
        {
          text: 'Enable',
          onPress: async () => {
            await AsyncStorage.setItem(BIOMETRIC_CREDENTIALS_KEY, JSON.stringify({ email, password }));
            await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true');
            setBiometricEnabled(true);
          },
        },
      ]
    );
  };

  const handleLogin = async () => {
    if (!loginEmail.trim() || !loginPass.trim()) {
      setLoginError('Please enter email and password.');
      return;
    }

    setLoginError('');
    setLoading(true);

    try {
      const authInstance = getAuth();
      await signInWithEmailAndPassword(authInstance, loginEmail.trim(), loginPass);

      if (rememberEmail) {
        await AsyncStorage.setItem(REMEMBER_EMAIL_KEY, 'true');
        await AsyncStorage.setItem(REMEMBER_EMAIL_KEY + '_value', loginEmail.trim());
      } else {
        await AsyncStorage.removeItem(REMEMBER_EMAIL_KEY);
        await AsyncStorage.removeItem(REMEMBER_EMAIL_KEY + '_value');
      }

      if (biometricSupported && !biometricEnabled) {
        const email = loginEmail.trim();
        const password = loginPass;
        onAuthSuccess();
        setTimeout(() => promptEnableBiometric(email, password), 500);
      } else {
        if (biometricEnabled) {
          await AsyncStorage.setItem(BIOMETRIC_CREDENTIALS_KEY, JSON.stringify({ 
            email: loginEmail.trim(), 
            password: loginPass 
          }));
        }
        onAuthSuccess();
      }
    } catch (error: any) {
      console.error('Login error:', error.code, error.message, error);
      setLoginError(getFirebaseErrorMessage(error.code || ''));
    } finally {
      setLoading(false);
    }
  };

  const handleSendVerification = async () => {
    if (!newName.trim() || !newEmail.trim() || !newPass.trim() || !newPhone.trim()) {
      setSignupError('Please fill in all fields.');
      return;
    }

    if (!isValidPhoneNumber(newPhone)) {
      setSignupError('Please enter a valid phone number (10-15 digits). Use + for international.');
      return;
    }

    if (newPass.length < 6) {
      setSignupError('Password must be at least 6 characters.');
      return;
    }

    setSignupError('');
    setLoading(true);

    try {
      const normalizedPhone = normalizePhoneNumber(newPhone);
      const sendCode = httpsCallable(functions, 'sendVerificationCode');
      const result = await sendCode({ phoneNumber: normalizedPhone });
      const data = result.data as { success: boolean; message: string };

      if (data.success) {
        setMode('VERIFY');
        setVerificationCode('');
        setVerifyError('');
      } else {
        setSignupError('Failed to send verification code. Please try again.');
      }
    } catch (error: any) {
      console.error('Send verification error:', error);
      setSignupError(error.message || 'Failed to send verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndSignup = async () => {
    if (!verificationCode.trim() || verificationCode.length !== 6) {
      setVerifyError('Please enter the 6-digit verification code.');
      return;
    }

    setVerifyError('');
    setLoading(true);

    try {
      const normalizedPhone = normalizePhoneNumber(newPhone);
      const verify = httpsCallable(functions, 'verifyCode');
      const result = await verify({ phoneNumber: normalizedPhone, code: verificationCode });
      const data = result.data as { success: boolean; message: string };

      if (data.success) {
        // Create the account
        const authInstance = getAuth();
        await createUserWithEmailAndPassword(authInstance, newEmail.trim(), newPass);

        // Create user profile
        try {
          const createProfile = httpsCallable(functions, 'createUserProfile');
          await createProfile({
            fullName: newName.trim(),
            phoneNumber: normalizedPhone,
            email: newEmail.trim(),
          });
        } catch (profileError) {
          console.error('Error creating profile:', profileError);
        }

        onAuthSuccess();
      } else {
        setVerifyError('Invalid verification code. Please try again.');
      }
    } catch (error: any) {
      console.error('Verification error:', error);
      if (error.code === 'auth/email-already-in-use') {
        Alert.alert(
          'Account Already Exists',
          'An account with this email already exists. Would you like to log in instead?',
          [
            { text: 'Stay Here', style: 'cancel' },
            {
              text: 'Go to Login',
              onPress: () => {
                setMode('LOGIN');
                setLoginEmail(newEmail.trim());
                setLoginError('');
              },
            },
          ]
        );
        setVerifyError('');
      } else if (error.code) {
        setVerifyError(getFirebaseErrorMessage(error.code));
      } else {
        setVerifyError(error.message || 'Verification failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setLoading(true);
    setVerifyError('');

    try {
      const normalizedPhone = normalizePhoneNumber(newPhone);
      const sendCode = httpsCallable(functions, 'sendVerificationCode');
      const result = await sendCode({ phoneNumber: normalizedPhone });
      const data = result.data as { success: boolean };

      if (data.success) {
        Alert.alert('Code Sent', 'A new verification code has been sent to your phone.');
      } else {
        setVerifyError('Failed to resend code. Please try again.');
      }
    } catch (error: any) {
      setVerifyError(error.message || 'Failed to resend code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!resetEmail.trim()) {
      Alert.alert('Error', 'Please enter your email address.');
      return;
    }

    setLoading(true);

    try {
      const authInstance = getAuth();
      await sendPasswordResetEmail(authInstance, resetEmail.trim());
      setResetSent(true);
    } catch (error: any) {
      Alert.alert('Error', getFirebaseErrorMessage(error.code || ''));
    } finally {
      setLoading(false);
    }
  };

  const getBiometricLabel = () => {
    return biometricType === 'facial' ? 'Face ID' : 'Fingerprint';
  };

  const onAuthSuccess = () => {
    onLoginSuccess();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.logoContainer}>
              <Image
                source={require('../../assets/Logos/XNautical-Logo-Square.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.tagline}>XNautical: Marine Charts Pro</Text>
            <Text style={styles.subtitle}>
              Precision Navigation powered by NOAA & Global Hydrographic Data
            </Text>
          </View>

          {/* Content */}
          <View style={styles.content}>
            {mode === 'LOGIN' && (
              <View>
                <Text style={styles.formTitle}>Welcome Back</Text>

                {loginError !== '' && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{loginError}</Text>
                  </View>
                )}

                {/* Biometric Login Button */}
                {biometricSupported && biometricEnabled && (
                  <View style={styles.biometricSection}>
                    <TouchableOpacity
                      style={styles.biometricButton}
                      onPress={handleBiometricLogin}
                      disabled={biometricLoading}
                    >
                      {biometricLoading ? (
                        <ActivityIndicator color={colors.teal600} />
                      ) : (
                        <>
                          {biometricType === 'facial' ? (
                            <Scan size={32} color={colors.teal600} />
                          ) : (
                            <Fingerprint size={32} color={colors.teal600} />
                          )}
                          <Text style={styles.biometricButtonText}>
                            Login with {getBiometricLabel()}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    <View style={styles.dividerContainer}>
                      <View style={styles.dividerLine} />
                      <Text style={styles.dividerText}>or use email</Text>
                      <View style={styles.dividerLine} />
                    </View>
                  </View>
                )}

                <View style={styles.inputContainer}>
                  <Mail size={20} color={colors.slate400} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Email Address"
                    placeholderTextColor={colors.slate400}
                    value={loginEmail}
                    onChangeText={setLoginEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Lock size={20} color={colors.slate400} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor={colors.slate400}
                    value={loginPass}
                    onChangeText={setLoginPass}
                    secureTextEntry={!showLoginPassword}
                  />
                  <TouchableOpacity
                    onPress={() => setShowLoginPassword(!showLoginPassword)}
                    style={styles.eyeButton}
                  >
                    {showLoginPassword ? (
                      <EyeOff size={20} color={colors.slate400} />
                    ) : (
                      <Eye size={20} color={colors.slate400} />
                    )}
                  </TouchableOpacity>
                </View>

                <View style={styles.rememberRow}>
                  <TouchableOpacity
                    style={styles.rememberCheckbox}
                    onPress={() => setRememberEmail(!rememberEmail)}
                  >
                    {rememberEmail ? (
                      <View style={styles.checkboxChecked}>
                        <Check size={14} color={colors.white} />
                      </View>
                    ) : (
                      <View style={styles.checkboxUnchecked} />
                    )}
                    <Text style={styles.rememberText}>Remember email</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setMode('FORGOT');
                      setResetSent(false);
                      setResetEmail('');
                    }}
                  >
                    <Text style={styles.forgotLink}>Forgot Password?</Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleLogin}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <>
                      <Text style={styles.primaryButtonText}>Log In</Text>
                      <ArrowRight size={18} color={colors.white} />
                    </>
                  )}
                </TouchableOpacity>

                <View style={styles.switchMode}>
                  <Text style={styles.switchModeText}>Don't have an account? </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setMode('SIGNUP');
                      setSignupError('');
                    }}
                  >
                    <Text style={styles.switchModeLink}>Create Account</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {mode === 'SIGNUP' && (
              <View>
                <Text style={styles.formTitle}>Create Account</Text>

                {signupError !== '' && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{signupError}</Text>
                  </View>
                )}

                <View style={styles.inputContainer}>
                  <UserIcon size={20} color={colors.slate400} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Full Name"
                    placeholderTextColor={colors.slate400}
                    value={newName}
                    onChangeText={setNewName}
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Mail size={20} color={colors.slate400} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Email Address"
                    placeholderTextColor={colors.slate400}
                    value={newEmail}
                    onChangeText={setNewEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Phone size={20} color={colors.slate400} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Phone (+1 for US, +44 for UK, etc.)"
                    placeholderTextColor={colors.slate400}
                    value={newPhone}
                    onChangeText={handlePhoneChange}
                    keyboardType="phone-pad"
                    maxLength={20}
                  />
                </View>

                <View style={styles.inputContainer}>
                  <Lock size={20} color={colors.slate400} style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="Password (min 6 characters)"
                    placeholderTextColor={colors.slate400}
                    value={newPass}
                    onChangeText={setNewPass}
                    secureTextEntry={!showSignupPassword}
                  />
                  <TouchableOpacity
                    onPress={() => setShowSignupPassword(!showSignupPassword)}
                    style={styles.eyeButton}
                  >
                    {showSignupPassword ? (
                      <EyeOff size={20} color={colors.slate400} />
                    ) : (
                      <Eye size={20} color={colors.slate400} />
                    )}
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleSendVerification}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <>
                      <Text style={styles.primaryButtonText}>Send Verification Code</Text>
                      <ArrowRight size={18} color={colors.white} />
                    </>
                  )}
                </TouchableOpacity>

                <View style={styles.switchMode}>
                  <Text style={styles.switchModeText}>Already have an account? </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setMode('LOGIN');
                      setLoginError('');
                    }}
                  >
                    <Text style={styles.switchModeLink}>Log In</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {mode === 'VERIFY' && (
              <View>
                <TouchableOpacity style={styles.backButton} onPress={() => setMode('SIGNUP')}>
                  <ChevronLeft size={16} color={colors.slate400} />
                  <Text style={styles.backButtonText}>Back</Text>
                </TouchableOpacity>

                <View style={styles.verifyHeader}>
                  <View style={styles.verifyIcon}>
                    <Shield size={32} color={colors.teal600} />
                  </View>
                  <Text style={styles.formTitle}>Verify Your Phone</Text>
                  <Text style={styles.verifySubtitle}>
                    We sent a 6-digit code to{'\n'}
                    <Text style={styles.bold}>{newPhone}</Text>
                  </Text>
                </View>

                {verifyError !== '' && (
                  <View style={styles.errorBox}>
                    <Text style={styles.errorText}>{verifyError}</Text>
                  </View>
                )}

                <View style={styles.codeInputContainer}>
                  <TextInput
                    style={styles.codeInput}
                    placeholder="000000"
                    placeholderTextColor={colors.slate300}
                    value={verificationCode}
                    onChangeText={(text: string) =>
                      setVerificationCode(text.replace(/\D/g, '').slice(0, 6))
                    }
                    keyboardType="number-pad"
                    maxLength={6}
                    textAlign="center"
                  />
                </View>

                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={handleVerifyAndSignup}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <>
                      <Text style={styles.primaryButtonText}>Verify & Create Account</Text>
                      <CheckCircle size={18} color={colors.white} />
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.resendButton}
                  onPress={handleResendCode}
                  disabled={loading}
                >
                  <Text style={styles.resendText}>Didn't receive a code? </Text>
                  <Text style={styles.resendLink}>Resend</Text>
                </TouchableOpacity>
              </View>
            )}

            {mode === 'FORGOT' && (
              <View>
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => {
                    setMode('LOGIN');
                    setResetSent(false);
                    setResetEmail('');
                  }}
                >
                  <ChevronLeft size={16} color={colors.slate400} />
                  <Text style={styles.backButtonText}>Back to Login</Text>
                </TouchableOpacity>

                {!resetSent ? (
                  <View>
                    <Text style={styles.formTitle}>Reset Password</Text>
                    <Text style={styles.formSubtitle}>
                      Enter your email address and we'll send you a link to reset your password.
                    </Text>

                    <View style={styles.inputContainer}>
                      <Mail size={20} color={colors.slate400} style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="Email Address"
                        placeholderTextColor={colors.slate400}
                        value={resetEmail}
                        onChangeText={setResetEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </View>

                    <TouchableOpacity
                      style={styles.primaryButton}
                      onPress={handleResetPassword}
                      disabled={loading}
                    >
                      {loading ? (
                        <ActivityIndicator color={colors.white} />
                      ) : (
                        <Text style={styles.primaryButtonText}>Send Reset Link</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.successContainer}>
                    <View style={styles.successIcon}>
                      <CheckCircle size={32} color={colors.green600} />
                    </View>
                    <Text style={styles.successTitle}>Check your inbox</Text>
                    <Text style={styles.successText}>
                      We sent a password reset link to{' '}
                      <Text style={styles.bold}>{resetEmail}</Text>.
                    </Text>
                    <TouchableOpacity
                      style={styles.primaryButton}
                      onPress={() => {
                        setMode('LOGIN');
                        setResetSent(false);
                        setResetEmail('');
                      }}
                    >
                      <Text style={styles.primaryButtonText}>Return to Login</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.navy900,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 16 : 60,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
  },
  header: {
    backgroundColor: colors.navy800,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  logoContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 16,
    padding: 8,
    marginBottom: 12,
  },
  logoImage: {
    width: 160,
    height: 160,
  },
  tagline: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.gold400,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.85)',
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: 16,
  },
  content: {
    padding: 24,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.slate800,
    marginBottom: 20,
    textAlign: 'center',
  },
  formSubtitle: {
    fontSize: 14,
    color: colors.slate500,
    marginBottom: 16,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: colors.red50,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    color: colors.red600,
    fontSize: 14,
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.slate300,
    borderRadius: 12,
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.slate800,
  },
  eyeButton: {
    padding: 4,
  },
  rememberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  rememberCheckbox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkboxChecked: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: colors.teal600,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  checkboxUnchecked: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.slate300,
    marginRight: 8,
  },
  rememberText: {
    color: colors.slate500,
    fontSize: 14,
  },
  forgotLink: {
    color: colors.teal600,
    fontWeight: '600',
  },
  biometricSection: {
    marginBottom: 20,
  },
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.teal50,
    borderWidth: 2,
    borderColor: colors.teal600,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    gap: 12,
  },
  biometricButtonText: {
    color: colors.teal700,
    fontSize: 16,
    fontWeight: '700',
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.slate200,
  },
  dividerText: {
    color: colors.slate400,
    fontSize: 12,
    paddingHorizontal: 12,
    fontWeight: '500',
  },
  primaryButton: {
    backgroundColor: colors.navy800,
    paddingVertical: 14,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  primaryButtonText: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 16,
  },
  switchMode: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  switchModeText: {
    color: colors.slate500,
    fontSize: 14,
  },
  switchModeLink: {
    color: colors.gold600,
    fontWeight: '700',
    fontSize: 14,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 4,
  },
  backButtonText: {
    color: colors.slate400,
    fontWeight: '700',
    fontSize: 14,
  },
  verifyHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  verifyIcon: {
    width: 64,
    height: 64,
    backgroundColor: colors.teal50,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  verifySubtitle: {
    fontSize: 14,
    color: colors.slate500,
    textAlign: 'center',
    lineHeight: 20,
  },
  codeInputContainer: {
    marginBottom: 16,
  },
  codeInput: {
    borderWidth: 2,
    borderColor: colors.gold400,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    fontSize: 28,
    fontWeight: '700',
    color: colors.slate800,
    letterSpacing: 8,
    backgroundColor: colors.slate50,
  },
  resendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  resendText: {
    color: colors.slate500,
    fontSize: 14,
  },
  resendLink: {
    color: colors.teal600,
    fontWeight: '700',
    fontSize: 14,
  },
  successContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  successIcon: {
    width: 64,
    height: 64,
    backgroundColor: colors.green100,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.slate800,
    marginBottom: 8,
  },
  successText: {
    color: colors.slate500,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  bold: {
    fontWeight: '700',
  },
});

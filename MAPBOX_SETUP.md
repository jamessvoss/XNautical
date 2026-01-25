# Mapbox Download Token Setup

The Android build requires a Mapbox **Download Token** with `DOWNLOADS:READ` scope to access Mapbox SDK dependencies.

## Quick Setup Steps:

### 1. Get Your Download Token

1. Go to: https://account.mapbox.com/access-tokens/
2. Click **"Create a token"**
3. Token name: `XNautical Download Token`
4. **Important:** Check the **"DOWNLOADS:READ"** scope checkbox
5. Click **"Create token"**
6. Copy the token (starts with `sk.`)

### 2. Add Token to .env File

Open `.env` and replace `YOUR_SECRET_DOWNLOAD_TOKEN_HERE` with your actual token:

```bash
RNMAPBOX_MAPS_DOWNLOAD_TOKEN=sk.your_actual_token_here
```

### 3. Add Token to gradle.properties

Add this line to `android/gradle.properties`:

```properties
MAPBOX_DOWNLOADS_TOKEN=sk.your_actual_token_here
```

### 4. Rebuild the App

```bash
npx expo run:android
```

## Alternative: Use Expo Go (No Build Required)

If you want to test quickly without building:

```bash
npm start
# Then scan QR code with Expo Go app
```

**Note:** Some native features may not work in Expo Go, so building the app is recommended for full functionality.

# Firestore Security Rules for Boat Performance

## Add these rules to your Firestore Security Rules in the Firebase Console

Navigate to: Firebase Console → Firestore Database → Rules

Add the following rules to allow users to manage their boat data:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Existing rules for users, waypoints, routes, etc...
    
    // Boat Performance rules
    match /users/{userId}/boats/{boatId} {
      // Allow users to read, write, update, and delete their own boats
      allow read, write, update, delete: if request.auth != null && request.auth.uid == userId;
      
      // Allow creating new boats
      allow create: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Complete Example (if starting fresh)

If you don't have existing rules, here's a complete example:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // User documents
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      
      // Waypoints subcollection
      match /waypoints/{waypointId} {
        allow read, write, delete: if request.auth != null && request.auth.uid == userId;
      }
      
      // Routes subcollection
      match /routes/{routeId} {
        allow read, write, delete: if request.auth != null && request.auth.uid == userId;
      }
      
      // Boats subcollection (NEW)
      match /boats/{boatId} {
        allow read, write, delete: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

## How to Update

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project (XNautical)
3. Click "Firestore Database" in the left sidebar
4. Click the "Rules" tab at the top
5. Add the boat rules above
6. Click "Publish"

## Testing

After updating the rules, try creating a boat again. The cloud storage should work!

## Note

The app will automatically fall back to local storage if cloud storage fails, so the feature will work even without these rules. However, adding these rules will enable:
- Cloud backup of boat data
- Sync across devices
- Real-time updates

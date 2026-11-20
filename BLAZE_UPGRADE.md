# Spark → Blaze (পরে)

এই প্রজেক্ট এখন **Spark (ফ্রি)** মোডে চলে: Cloud Functions বন্ধ, ক্লায়েন্ট সরাসরি Firestore-এ লেখে (rules দিয়ে সুরক্ষিত)।

Blaze-এ যেতে:
1. Firebase Console-এ প্ল্যান Blaze করুন (বিলিং চালু হবে। বাজেট alert অবশ্যই বসান)।
2. `cd functions && npm install && npm run build`, তারপর `npx firebase-tools deploy --only functions --project bana-a5770`।
3. GitHub → Settings → Secrets and variables → Actions → **Variables**:
   - `VITE_FIREBASE_PLAN_MODE` = `blaze`
   - `VITE_ENABLE_CLOUD_FUNCTIONS` = `true`
4. Actions → "Deploy BANA site to GitHub Pages" → Run workflow।

Blaze-এ যা বাড়তি পাবেন: সার্ভার-সাইড অর্ডার/দাম যাচাই, follower counter ট্রিগার, সম্পূর্ণ অ্যাকাউন্ট মোছা (কমেন্ট/মেসেজসহ, `deleteMyAccountData`), অ্যাডমিন claims sync, পেমেন্ট gateway।

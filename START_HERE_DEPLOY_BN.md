# BANA — লাইভ করার সহজ গাইড (GitHub Pages + Firebase Spark)

এই ফোল্ডারের **সব ফাইল** একসাথে GitHub রিপোজিটরিতে আপলোড করলেই সাইট নিজে নিজে build হয়ে প্রকাশিত হবে।
ফাইলের ভেতরের ফোল্ডার-কাঠামো (`src/`, `backend/`, `.github/` ইত্যাদি) যেমন আছে তেমনই রাখতে হবে। নাম বা জায়গা বদলালে build ভেঙে যাবে।

## ধাপ ১ — GitHub-এ আপলোড
1. GitHub-এ নতুন রিপোজিটরি খুলুন (নাম যা খুশি)।
2. এই ZIP-এর ভেতরের সব ফাইল ও ফোল্ডার (লুকানো `.github` ফোল্ডারসহ) আপলোড করুন, branch: `main`।
3. **Settings → Pages → Source** এ **GitHub Actions** নির্বাচন করুন।
4. **Actions** ট্যাবে "Deploy BANA site to GitHub Pages" শেষ হওয়া পর্যন্ত অপেক্ষা করুন (৩–৫ মিনিট)।

সাইটের ঠিকানা: `https://আপনার-নাম.github.io/রিপোজিটরি-নাম/`
অ্যাডমিন প্যানেল: ওই ঠিকানার শেষে `/admin` (ইউজার সাইট ও অ্যাডমিন একই build, অ্যাডমিন রোল ছাড়া ঢোকা যায় না)।

## ধাপ ২ — Firebase-এ আপনার ডোমেইন অনুমোদন (বাধ্যতামূলক)
Firebase Console → Authentication → Settings → **Authorized domains** → `আপনার-নাম.github.io` যোগ করুন। না করলে লগইন কাজ করবে না।

## ধাপ ৩ — Security Rules প্রকাশ (Spark প্ল্যানে বিনামূল্যে)
`firestore.rules` ও `storage.rules` GitHub Pages-এ কাজ করে না, এগুলো Firebase-এ যায়। সহজ উপায়:
1. Firebase Console → Project settings → Service accounts → **Generate new private key**।
2. GitHub → Settings → Secrets and variables → Actions → **New repository secret**: নাম `FIREBASE_SERVICE_ACCOUNT`, মান = ডাউনলোড করা JSON-এর পুরো লেখা।
3. Actions → "Deploy Firebase security rules" → **Run workflow**। এরপর থেকে rules বদলালে নিজে নিজে প্রকাশ হবে।

(নিজে করতে চাইলে: `npx firebase-tools deploy --only firestore:rules,firestore:indexes,storage --project bana-a5770`)

## ধাপ ৪ — Backend (Render) — ঐচ্ছিক, কল/মেসেজিং রিয়েলটাইমের জন্য
1. Render.com → New → **Blueprint** → এই রিপোজিটরি নির্বাচন করুন (`render.yaml` নিজে সব সাজাবে)।
2. Render Environment-এ বসান: `CORS_ALLOWED_ORIGINS` = `https://আপনার-নাম.github.io` (শুধু origin, শেষে পাথ নয়)।
3. Supabase লাগলে `SUPABASE_*` ভেরিয়েবল বসান।
4. GitHub → Settings → Variables-এ `VITE_BACKEND_URL` = Render-এর ঠিকানা দিয়ে workflow আবার চালান।
Backend না থাকলেও সাইট চলে (Firestore-ভিত্তিক WebRTC কলিং দিয়ে)।

## ধাপ ৫ — Media Worker (Cloudflare) — ঐচ্ছিক
`workers/bana-media-broker/wrangler.toml`-এর `ALLOWED_ORIGINS`-এ `https://আপনার-নাম.github.io` যোগ করে deploy করুন।

## Super Admin নিরাপত্তা (গুরুত্বপূর্ণ)
আপনার bootstrap admin ইমেইল এখনো সুপার অ্যাডমিন। এটা বন্ধ করার নিরাপদ নিয়ম:
1. আগে অ্যাডমিন প্যানেল থেকে নিজের জন্য `adminRoles` এ `super_admin` রোল নিশ্চিত করুন এবং সেটি দিয়ে লগইন করে পরীক্ষা করুন।
2. তারপর Firestore-এ `adminBootstrap/state` ডকুমেন্টে `{ disabled: true }` বসান।
**ধাপ ১ ছাড়া ধাপ ২ করবেন না, নইলে অ্যাডমিন অ্যাক্সেস হারাতে পারেন।**

## Paid সার্ভিস (Agora / 100ms) নিরাপত্তা
Paid provider এখন শুধু সার্ভারের `APPROVED_PAID_PROVIDERS` ভেরিয়েবল দিয়ে অনুমোদিত হয় (যেমন `100ms`)। খালি থাকলে সব paid সার্ভিস বন্ধ। কোনো ইউজার ক্লায়েন্ট থেকে এটি পাল্টাতে পারে না।

## পরে Blaze প্ল্যানে যাওয়া
`BLAZE_UPGRADE.md` দেখুন। শুধু কয়েকটি ভেরিয়েবল বদলাতে হয়, কোড বদলাতে হয় না।

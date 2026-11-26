# BANA — সম্পূর্ণ গাইড (ডিপ্লয়, ভেরিয়েবল, API, নিরাপত্তা)

এই একটা ফাইলেই সব নির্দেশনা আছে। ধাপগুলো ক্রমানুযায়ী করুন।

---

## ১. আপনার কাছে ৩টা জিপ আছে

| জিপ | ভেতরে কী | কোথায় যাবে |
|---|---|---|
| `BANA_SITE_USER_AND_ADMIN.zip` | ইউজার সাইট + `admin/` (অ্যাডমিন কনসোল) + GitHub Pages workflow + `backend/` + `workers/` + `render.yaml` | **GitHub রিপোজিটরি** |
| `BANA_SECURITY_FIREBASE_FILES.zip` | `firestore.rules`, `storage.rules`, indexes, `security/`, `functions/`, টেস্ট, Termux ডিপ্লয় স্ক্রিপ্ট | **Firebase** (GitHub Pages-এ নয়) |
| `BANA_RULES_ONLY.zip` | শুধু rules + indexes + ছোট ডিপ্লয় স্ক্রিপ্ট | **Firebase** |

> সিকিউরিটি ফাইল GitHub Pages রিপোতে রাখবেন না। Pages-এ যা আছে সব ইন্টারনেটে খোলা।

## ২. সাইটের ঠিকানা
- ইউজার সাইট: `https://movilover.github.io/<রিপো-নাম>/`
- অ্যাডমিন: `https://movilover.github.io/<রিপো-নাম>/admin/`

দুটো একই workflow-তে একসাথে বিল্ড হয় (`npm run build:all`)।

---

## ৩. Termux-এ প্রথমবার সেটআপ

```bash
pkg update && pkg install -y git nodejs unzip
git config --global user.name "আপনার নাম"
git config --global user.email "আপনার-ইমেইল"
```
GitHub-এ পুশ করতে পাসওয়ার্ডের জায়গায় **Personal Access Token** (GitHub → Settings → Developer settings → Tokens, `repo` + `workflow` অনুমতি) লাগবে।

## ৪. সাইট (ইউজার + অ্যাডমিন) GitHub Pages-এ

```bash
unzip BANA_SITE_USER_AND_ADMIN.zip
cd BANA_SITE
bash deploy-site-termux.sh      # রিপো URL চাইবে, তারপর git push করবে
```
তারপর GitHub-এ:
1. রিপো → **Settings → Pages → Source = GitHub Actions**
2. **Actions** ট্যাবে "Deploy BANA (User site + Admin)" সবুজ হওয়া পর্যন্ত অপেক্ষা (৩–৫ মিনিট)।
3. Firebase Console → Authentication → Settings → **Authorized domains** → `movilover.github.io` যোগ করুন (না করলে লগইন হবে না)।

পরে কোড বদলালে আবার `bash deploy-site-termux.sh` চালালেই হবে।

## ৫. Firebase rules ডিপ্লয় (Termux, ফ্রি Spark প্ল্যান)

```bash
unzip BANA_SECURITY_FIREBASE_FILES.zip     # অথবা BANA_RULES_ONLY.zip
cd BANA_SECURITY_FIREBASE_FILES
bash deploy-termux.sh
```
স্ক্রিপ্ট `firebase-tools` ইনস্টল করে, `firebase login --no-localhost` দিয়ে লগইন করায় এবং `firestore.rules`, `storage.rules`, `firestore.indexes.json` প্রকাশ করে (প্রজেক্ট `bana-a5770`)। `functions/` ডিপ্লয় হয় না, কারণ Cloud Functions-এ Blaze প্ল্যান লাগে।
চাইলে Firebase Console-এও rules কপি-পেস্ট করা যায়।

---

## ৬. ভেরিয়েবল কিভাবে যোগ করবেন

### ক) GitHub Pages ভেরিয়েবল (সবার জন্য খোলা, **গোপন কিছু নয়**)
GitHub রিপো → **Settings → Secrets and variables → Actions → Variables ট্যাব → New repository variable**।
যোগ করার পর **Actions → Deploy BANA → Run workflow** চালান, নইলে নতুন মান বিল্ডে ঢুকবে না।

| নাম | কখন লাগে | উদাহরণ |
|---|---|---|
| `VITE_BACKEND_URL` | Render ব্যাকএন্ড চালালে | `https://bana-realtime-backend.onrender.com` |
| `VITE_MEDIA_BROKER_URL` | Cloudflare media worker চালালে | `https://bana-media-broker.<নাম>.workers.dev` |
| `VITE_CALLING_PROVIDER` | ডিফল্ট `webrtc_builtin` (সার্ভার ছাড়া চলে) | `webrtc_builtin` |
| `VITE_FIREBASE_PLAN_MODE` | ডিফল্ট `spark` | `spark` |
| `VITE_ENABLE_CLOUD_FUNCTIONS` | ডিফল্ট `false` (Blaze নিলে `true`) | `false` |
| `VITE_ADMIN_IDLE_MINUTES` | অ্যাডমিন অটো-লগআউট সময় | `30` |
| `VITE_ADMIN_URL`, `VITE_USER_SITE_URL` | সাধারণত দরকার নেই, নিজে সেট হয় | |
| `VITE_FIREBASE_*` | ফাঁকা রাখুন (প্রজেক্টের ভেতরেই `bana-a5770` কনফিগ আছে) | |

> **নিয়ম:** `VITE_` দিয়ে শুরু হওয়া সব মান বিল্ডের সময় ওয়েবসাইটের JavaScript-এ ঢুকে যায়। তাই কোনো পাসওয়ার্ড/সিক্রেট কী এখানে **কখনো** দেবেন না।

### খ) সিক্রেট কোথায় যাবে (GitHub Pages-এ নয়)

| কী | কোথায় বসবে |
|---|---|
| TURN_SHARED_SECRET, LIVEKIT_API_KEY/SECRET, AGORA_*, HMS_*, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET, VAPID_PRIVATE_KEY | **Render** → আপনার সার্ভিস → Environment |
| R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, B2_KEY_ID, B2_APPLICATION_KEY, ইত্যাদি স্টোরেজ কী | **Cloudflare Worker**: `npx wrangler secret put R2_ACCESS_KEY_ID` (প্রতিটার জন্য) |
| SSLCOMMERZ_*, BKASH_*, NAGAD_*, STRIPE_* (পেমেন্ট) | Firebase Functions env (Blaze) — এখন দরকার নেই, ডিফল্টে ম্যানুয়াল পেমেন্ট |
| FIREBASE_SERVICE_ACCOUNT (rules অটো-ডিপ্লয় চাইলে) | সিকিউরিটি রিপোর GitHub **Secrets** |

---

## ৭. কলিং, ভিডিও, ভয়েস মেসেজ — কিভাবে কাজ করে

**ডিফল্ট (কিছু সেট না করলেও চলে):** ভয়েস/ভিডিও কল Firestore + WebRTC (`webrtc_builtin`) দিয়ে চলে। ভয়েস মেসেজ ও মিডিয়া Firebase Storage দিয়ে। শুধু GitHub Pages + Firebase দরকার।

**GitHub Pages, না Render?** — GitHub Pages শুধু ওয়েবসাইট দেখায়, সার্ভার চালাতে পারে না এবং সিক্রেট লুকাতে পারে না।
- সিক্রেট ছাড়া চললে (ডিফল্ট কলিং) → শুধু GitHub Pages যথেষ্ট।
- সিক্রেট লাগে এমন প্রোভাইডার (TURN, LiveKit, Agora, 100ms, Supabase সার্ভিস কী, Web Push) → **Render ব্যাকএন্ড** লাগবে।
- বড় ভিডিও R2/B2 তে রাখতে চাইলে → **Cloudflare Worker** (`workers/bana-media-broker`) লাগবে।

**Render সেটআপ (ঐচ্ছিক):**
1. render.com → New → **Blueprint** → আপনার GitHub রিপো বাছুন (`render.yaml` নিজে সব সাজাবে)।
2. Environment-এ `CORS_ALLOWED_ORIGINS` = `https://movilover.github.io` (শুধু origin, শেষে পাথ বা `/` নয়)।
3. দরকারি সিক্রেট বসান (উপরের টেবিল)।
4. Render-এর ঠিকানা GitHub Variable `VITE_BACKEND_URL`-এ দিয়ে workflow আবার চালান।
5. পেইড প্রোভাইডার (Agora/100ms) `APPROVED_PAID_PROVIDERS` ফাঁকা থাকলে ব্লক থাকে; আপনি অনুমোদন না দিলে চালু হয় না।

**Cloudflare Worker (ঐচ্ছিক):** `workers/bana-media-broker/wrangler.toml`-এর `ALLOWED_ORIGINS`-এ `https://movilover.github.io` যোগ করে ডিপ্লয় করুন, সিক্রেট `wrangler secret put` দিয়ে, তারপর `VITE_MEDIA_BROKER_URL` ভেরিয়েবল দিন।

---

## ৮. অ্যাডমিনে লগইন
- ঠিকানা: `.../admin/`
- bootstrap সুপার অ্যাডমিন ইমেইল: `omor.faruk.sojol.2@gmail.com` (rules-এ আছে)।
- **Continue with Google** দিয়ে ঢুকুন (সবচেয়ে সহজ), অথবা Firebase Console → Authentication → Sign-in method-এ Email/Password চালু করে সেই ইউজারে পাসওয়ার্ড সেট করুন। পাসওয়ার্ড কোডে বা GitHub-এ রাখা হয়নি, রাখাও উচিত নয়।
- ইমেইল verified হতে হবে।

**সুপার অ্যাডমিন নিরাপত্তা:** আগে অ্যাডমিন প্যানেল থেকে নিজের জন্য `adminRoles`-এ `super_admin` নিশ্চিত করে লগইন পরীক্ষা করুন। তারপর (শুধু তারপর) Firestore-এ `adminBootstrap/state` ডকুমেন্টে `{ disabled: true }` বসান। আগের ধাপ ছাড়া এটা করলে অ্যাডমিন অ্যাক্সেস হারাতে পারেন।

---

## ৯. এই আপডেটে যা যা আছে

- **ডিজাইন:** কোবাল্ট ব্লু (`#1D4ED8`) প্রধান রঙ, এমারেল্ড অ্যাকসেন্ট, নতুন B লোগো, লাইট/ডার্ক সারফেস।
- **আপলোড:** Post, Story, Reel তিনটা আলাদা স্ক্রিন। "Create" বাটনে Post / Story / Reel বাছাই। Reel স্ক্রিনে সব ফিল্ড (ভিডিও, শিরোনাম, ক্যাপশন, বিবরণ, হ্যাশট্যাগ, সাউন্ড, ক্যাটাগরি, অডিয়েন্স, .vtt, Save Draft, Publish Reel)।
- **আপলোড প্রগ্রেস:** BANA লোগোসহ কার্ড, ফাইলের নাম, আসল %, স্ট্যাটাস, Retry, Cancel (Reel)। সার্ভারে লেখা শেষ হলেই "সফল"। ডুপ্লিকেট সাবমিট বন্ধ।
- **কমেন্ট:** সংখ্যা, প্রোফাইল ছবি, নাম, সময়, Reply ও থ্রেড, নিজের কমেন্ট/রিপ্লাই ডিলিট, লোডিং, এরর + Retry, খালি অবস্থা (পোস্ট, ছবি, ভিডিও পূর্ণ-স্ক্রিন, Reel)।
- **রিঅ্যাকশন:** Like/Love/Haha/Wow/Sad/Angry — ট্যাপে Like, চেপে ধরলে সিলেক্টর, বদলানো ও তুলে নেওয়া, কমেন্টেও। সাউন্ড ঐচ্ছিক (Settings → Reaction Sound Effects), আলাদা অডিও ফাইল লাগে না।
- **লোডিং / অফলাইন / 404:** স্কেলিটন, ২০ সেকেন্ড পর "Try again", "No Internet Connection" ব্যানার ও অটো-রিস্টোর, BANA 404 পেজ।
- **বাগ ফিক্স (পুরনো কোডে ছিল):** ভিডিও পূর্ণ-স্ক্রিনে খুললে React "Rendered more hooks" এরর হয়ে ক্র্যাশ করত। ঠিক করা হয়েছে।

## ১০. সীমাবদ্ধতা (সৎভাবে)
- **ব্যাকগ্রাউন্ড আপলোড:** অ্যাপের ভেতরে অন্য পেজে গেলে আপলোড চলতে থাকে। ট্যাব বন্ধ/রিলোড করলে বা ফোন ব্রাউজার মেরে ফেললে থেমে যায়। রিলোডের পরেও চালাতে সার্ভিস ওয়ার্কার ও নতুন আপলোড স্থাপত্য লাগবে, যা বানানো হয়নি।
- **কমেন্ট রিঅ্যাকশন সংখ্যা:** মোট সংখ্যা (`likesCount`) এবং ইউজারের নিজের রিঅ্যাকশন দেখায়; ধরনভিত্তিক আলাদা সংখ্যা নয়।
- **কাউন্টার:** আগের মতোই ক্লায়েন্ট `increment` দিয়ে চলে। শুধু সার্ভারের গোনার ওপর নির্ভর করতে চাইলে Cloud Functions (Blaze) লাগবে।
- **কমেন্ট মডারেশন:** অ্যাডমিন প্যানেল থেকেই; ফিডে আলাদা মডারেটর বাটন যোগ করা হয়নি।
- **Group Buy, Messenger-এর Marketplace ফিল্টার, ফোন-নম্বর সাইন-ইন:** অ্যাপে আগে ছিল না, নতুন ডাটাবেস ও rules লাগত বলে বানানো হয়নি।

## ১১. সমস্যা হলে
| লক্ষণ | সমাধান |
|---|---|
| সাদা পেজ | Settings → Pages → Source অবশ্যই **GitHub Actions**; Actions ট্যাবে সবুজ টিক দেখুন |
| লগইন হয় না | Firebase → Authorized domains-এ `movilover.github.io` |
| অ্যাডমিন "access required" | Google দিয়ে সুপার অ্যাডমিন ইমেইলে ঢুকুন; ইমেইল verified কিনা দেখুন |
| নতুন ভেরিয়েবল কাজ করছে না | Variable যোগ করার পর workflow **Run workflow** করুন |
| কল/মেসেজ রিয়েলটাইম ধীর | Render ফ্রি প্ল্যান ঘুমিয়ে পড়ে; প্রথম রিকোয়েস্ট ধীর হয় |

## ১২. টেস্ট
চালানো হয়েছে এবং পাস: ইউজার সাইট ও অ্যাডমিন টাইপ-চেক, সম্মিলিত বিল্ড, rules-parity টেস্ট (৪৯), storage (৭), providers (১১), নতুন ব্রাউজার-ধরনের (jsdom) ২৩টা টেস্ট (রিঅ্যাকশন, আপলোড কার্ড, অফলাইন, লোডিং, স্ক্রিন আলাদা থাকা, পূর্ণ-স্ক্রিন ভিডিও ক্র্যাশ ফিক্স)।
**চালানো যায়নি (NOT VERIFIED):** Firestore rules এমুলেটর টেস্ট (`npm run test:rules` — আপনার ডিভাইসে চালান), আসল ব্রাউজারে চোখে দেখা, আসল Firebase-এ আপলোড/কমেন্ট, ডিপ্লয়ড সাইট, Render/Cloudflare সংযোগ।
লোকালে: `npm run install:all && npm run lint:all && npm run build:all && npm run test:ui:dom`

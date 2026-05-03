# 🚀 PHASE 0: FOUNDATION SETUP GUIDE

**Goal:** Have a live app on the internet (https://yourapp.vercel.app)

**Timeline:** Today to tomorrow (few hours work)

---

## PART 1: LOCAL TESTING (Today)

### Step 1.1: Install Python Dependencies

```bash
# Navigate to backend folder
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install packages
pip install -r requirements.txt
```

**Expected output:**
```
Successfully installed fastapi-0.104.1 uvicorn-0.24.0 ...
```

### Step 1.2: Test Backend Locally

```bash
# Still in backend folder
# Start the server
python main.py
```

**Expected output:**
```
============================================================
Monte Carlo Backend - Phase 0
============================================================
🚀 Starting server on http://0.0.0.0:8000
📖 Documentation at http://localhost:8000/docs
============================================================
```

**Now test these URLs:**
- http://localhost:8000/ → See API info ✅
- http://localhost:8000/health → See status ✅
- http://localhost:8000/docs → See Swagger UI ✅

**If all work:** Backend OK! ✅

### Step 1.3: Install Node Dependencies

```bash
# In another terminal, navigate to frontend
cd frontend

# Install Node packages
npm install
# or
yarn install
```

**Expected:** `added XXX packages in YYYs`

### Step 1.4: Test Frontend Locally

```bash
# Still in frontend folder
# Start development server
npm run dev
```

**Expected output:**
```
  ▲ Next.js 14.0.0
  - Local:        http://localhost:3000
```

**Now visit:** http://localhost:3000

**Expected to see:**
- Monte Carlo v3 title
- API Status card (should say "❌ Cannot reach API" at first)

**Why disconnected?** Frontend is looking for backend at `http://localhost:8000`
This is CORRECT - you should see this message. It means CORS is working.

### Step 1.5: Test Frontend → Backend Connection

**Expected flow:**
1. Frontend loads (http://localhost:3000)
2. Frontend calls GET http://localhost:8000/health
3. Backend responds
4. Frontend shows "✅ API Connected"

**If you see ✅ API Connected:** Both are talking! 🎉

---

## PART 2: DEPLOYMENT TO CLOUD

### Step 2.1: Create GitHub Repository

**IMPORTANT:** You need GitHub to deploy to Vercel/Railway

```bash
# Navigate to project root
cd /path/to/Monte\ Carlo\ V1

# Initialize git (if not already done)
git init

# Create GitHub repo:
# 1. Go to github.com/new
# 2. Create "monte-carlo-v3"
# 3. Copy the commands
# 4. Paste and run them

# Example:
git add .
git commit -m "Phase 0: Initial backend and frontend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/monte-carlo-v3.git
git push -u origin main
```

### Step 2.2: Deploy Backend to Railway

**What is Railway?**
- Cloud platform to run web apps
- Free tier: $5 credit (enough for development)
- Easy GitHub integration

**Steps:**
1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your `monte-carlo-v3` repo
5. Select `backend` folder as root
6. Wait for deployment (~2 minutes)

**Expected result:**
- URL like: https://monte-carlo-backend-xxx.railway.app
- Status: "Deployed ✅"

**Test it:**
- Visit https://monte-carlo-backend-xxx.railway.app/health
- Should see: `{"status": "ok", ...}`

**Save this URL!** You'll need it for the frontend.

### Step 2.3: Deploy Frontend to Vercel

**What is Vercel?**
- Cloud platform for React/Next.js apps
- FREE forever
- Auto-deploys on git push

**Steps:**
1. Go to https://vercel.com
2. Sign up with GitHub
3. Click "New Project" → "Import Git Repository"
4. Select your `monte-carlo-v3` repo
5. Configure:
   - Framework Preset: "Next.js"
   - Root Directory: `frontend`
   - **Environment Variables:**
     - Key: `NEXT_PUBLIC_API_URL`
     - Value: `https://monte-carlo-backend-xxx.railway.app` (from step 2.2)
6. Click "Deploy"
7. Wait for deployment (~3-5 minutes)

**Expected result:**
- URL like: https://monte-carlo-v3.vercel.app
- Status: "Ready ✅"

### Step 2.4: Test Live Connection

**Visit:** https://monte-carlo-v3.vercel.app

**Expected:**
- Monte Carlo v3 page loads
- API Status card shows: "✅ API Connected"

**If you see connected:** 🎉 PHASE 0 COMPLETE!

---

## TROUBLESHOOTING

### Problem: "❌ Cannot reach API"

**Causes:**
1. Backend not deployed yet
2. Backend URL in Vercel env var is wrong
3. CORS misconfigured

**Fix:**
```
1. Check Railway dashboard - backend deployed?
2. Copy correct backend URL from Railway
3. Go to Vercel Settings → Environment Variables
4. Update NEXT_PUBLIC_API_URL
5. Redeploy frontend (Vercel → Deployments → Redeploy)
```

### Problem: "API Error (Status: 404)"

**Causes:** Endpoint doesn't exist

**Fix:**
- Check /health endpoint exists (should in main.py)
- Test with curl: `curl http://localhost:8000/health`

### Problem: "Cannot connect to localhost:8000"

**Causes:** Backend not running

**Fix:**
```bash
cd backend
python main.py
# Should show "🚀 Starting server..."
```

---

## SUCCESS CHECKLIST

Before moving to Phase 1, verify:

- [ ] Backend running locally (python main.py)
- [ ] Frontend running locally (npm run dev)
- [ ] Frontend shows "✅ API Connected" locally
- [ ] Backend deployed on Railway (green checkmark)
- [ ] Frontend deployed on Vercel (green checkmark)
- [ ] Can visit live Vercel URL and see "✅ API Connected"
- [ ] All 3 buttons (Dashboard, Simulator, Company) are enabled

**If all ✅:** You're ready for Phase 1! 🚀

---

## NEXT STEPS

Once Phase 0 is complete:
- Phase 1: Macro Dashboard (Weeks 2-4)
- Add Fred API integration
- Build macro indicator displays
- Add charts and EMA indicators

See: DETAILED_DEVELOPMENT_PLAN.md for Phase 1 details

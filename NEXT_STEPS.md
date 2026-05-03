# 🎯 Next Steps - Start Building Now

## Week 1: Phase 0 Setup

### Task 1.1: Create Backend Project
```bash
# Create backend directory
mkdir backend
cd backend

# Create virtual environment
python -m venv venv
venv\Scripts\activate  # Windows

# Install FastAPI
pip install fastapi uvicorn python-dotenv httpx pydantic

# Create main.py (skeleton in next section)
```

### Task 1.2: Create Frontend Project
```bash
# Create Next.js project
npx create-next-app@latest frontend --typescript --tailwind

cd frontend

# Install chart library
npm install recharts

# Deploy to Vercel (1 click in https://vercel.com)
```

### Task 1.3: Connect Backend & Frontend
```bash
# Backend CORS setup (see code below)
# Frontend API client (see code below)
# Test connection with first API call
```

---

## Code Templates to Copy-Paste

### Backend: FastAPI Skeleton (`backend/main.py`)

```python
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Monte Carlo API")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://your-frontend.vercel.app", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Environment variables
FRED_API_KEY = os.getenv("FRED_API_KEY")
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY")

# Health check
@app.get("/health")
async def health():
    return {"status": "ok"}

# Macro data endpoint
@app.get("/api/macro/inflation")
async def get_inflation():
    """Fetch inflation (CPI) from Fred"""
    async with httpx.AsyncClient() as client:
        params = {
            "series_id": "CPIAUCSL",
            "api_key": FRED_API_KEY,
            "limit": 252,
            "sort_order": "desc"
        }
        resp = await client.get(
            "https://api.stlouisfed.org/fred/series/observations",
            params=params
        )
    
    if resp.status_code != 200:
        raise HTTPException(status_code=500, detail="Fred API error")
    
    return resp.json()

# Company data endpoint
@app.get("/api/company/{ticker}")
async def get_company(ticker: str):
    """Fetch company data from Finnhub"""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://finnhub.io/api/v1/stock/profile2",
            params={"symbol": ticker, "token": FINNHUB_API_KEY}
        )
    
    if resp.status_code != 200:
        raise HTTPException(status_code=500, detail="Finnhub API error")
    
    return resp.json()

# Monte Carlo endpoint (placeholder)
@app.post("/api/simulate")
async def run_simulation(request: dict):
    """Run Monte Carlo simulation"""
    # TODO: Import your simulation.py module
    return {
        "status": "ok",
        "message": "Simulation endpoint placeholder"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

### Backend: `.env` file
```
FRED_API_KEY=your_fred_key
FINNHUB_API_KEY=your_finnhub_key
```

### Frontend: API Client (`frontend/lib/api.ts`)

```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export async function getInflation() {
  const response = await fetch(`${API_URL}/api/macro/inflation`);
  if (!response.ok) throw new Error('Failed to fetch inflation data');
  return response.json();
}

export async function getCompany(ticker: string) {
  const response = await fetch(`${API_URL}/api/company/${ticker}`);
  if (!response.ok) throw new Error(`Failed to fetch ${ticker} data`);
  return response.json();
}

export async function runSimulation(params: {
  ticker: string;
  horizon: number;
  n_sims: number;
}) {
  const response = await fetch(`${API_URL}/api/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('Simulation failed');
  return response.json();
}
```

### Frontend: Simple Dashboard (`frontend/pages/dashboard.tsx`)

```typescript
import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { getInflation, getCompany } from '@/lib/api';

export default function Dashboard() {
  const [inflationData, setInflationData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const data = await getInflation();
        // Transform Fred format to Recharts format
        const transformed = data.observations.map((obs: any) => ({
          date: obs.date,
          value: parseFloat(obs.value),
        }));
        setInflationData(transformed);
      } catch (error) {
        console.error('Error loading inflation data:', error);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  if (loading) return <div>Loading...</div>;

  return (
    <div className="p-8">
      <h1 className="text-4xl font-bold mb-8">📊 Monte Carlo Dashboard</h1>
      
      <div className="grid grid-cols-1 gap-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-2xl font-bold mb-4">📈 Inflation (CPI)</h2>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={inflationData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="value" stroke="#3b82f6" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
```

---

## Environment Setup Checklist

### Backend (.env)
```
✅ Get Fred API Key:
   1. Go to https://fred.stlouisfed.org/
   2. Register (free)
   3. Copy API key
   4. Add to .env: FRED_API_KEY=xxxxx

✅ Get Finnhub API Key:
   1. Go to https://finnhub.io/
   2. Sign up (free)
   3. Copy API key
   4. Add to .env: FINNHUB_API_KEY=xxxxx
```

### Deploy Backend (Free)
```
1. Create Railway account (https://railway.app)
2. Connect GitHub
3. Create new project from git repo
4. Set environment variables (Fred, Finnhub keys)
5. Deploy (1 click)
6. Copy API URL from Railway dashboard
```

### Deploy Frontend (Free)
```
1. Create Vercel account (https://vercel.com)
2. Connect GitHub
3. Import your frontend repo
4. Add env var: NEXT_PUBLIC_API_URL=https://your-railway-backend.railway.app
5. Deploy (1 click)
6. Live at https://your-frontend.vercel.app
```

---

## Week 1 Success Checklist

- [ ] Backend running on Railway with `/health` endpoint working
- [ ] Frontend deployed on Vercel
- [ ] Frontend can call backend API (test with `/api/macro/inflation`)
- [ ] Inflation chart displaying live Fred data
- [ ] Both URLs in your browser (no localhost)

**If all ✅ → You're ready for Week 2!**

---

## APIs to Get Keys

### Fred (Macro Data)
- URL: https://fred.stlouisfed.org/
- Why: Best macro data source (100% free, forever)
- Time: 2 minutes to register
- Key: Copy & paste to .env

### Finnhub (Company Data)
- URL: https://finnhub.io/
- Why: Company fundamentals, simple API
- Time: 2 minutes to register
- Key: Copy & paste to .env

### NewsAPI (News)
- URL: https://newsapi.org/
- Why: Company news sentiment
- Time: 2 minutes (optional, can skip Week 1)

### Yahoo Finance
- Already have via `yfinance` Python package
- No API key needed

---

## Week 2 Preview: Add Macro Dashboard

Once Week 1 works, Week 2 will add:

```typescript
// Add these endpoints to backend
GET /api/macro/unemployment
GET /api/macro/gdp
GET /api/macro/fed-rate
GET /api/macro/yield-curve
GET /api/macro/oil-price
// ... 20+ more

// Add these components to frontend
<MacroIndicatorCard indicator="unemployment" />
<MacroIndicatorCard indicator="fed-rate" />
<YieldCurveChart />
// ... responsive grid layout
```

---

## Questions to Answer Before You Start

1. **Do you have a GitHub account?**
   - If no: Create free at github.com
   - You'll need it for Railway + Vercel deployment

2. **Do you have 1 hour this week?**
   - Yes → Start Week 1 now
   - No → Schedule for next week

3. **Can you get Fred + Finnhub API keys?**
   - Both free and instant (2 min each)

---

## I'm Ready to Help

Once you:
1. Create backend/frontend skeleton
2. Get API keys
3. Deploy to Railway + Vercel

I can help you:
- Debug connection issues
- Build the macro dashboard (Week 2)
- Integrate your simulation code (Week 4)
- Optimize performance
- Add features incrementally

**Ready to start? Let me know when you:**
- Have backend running (or hit an error)
- Have frontend deployed (or hit an error)
- Can see both in browser

I'll help you debug any issues! 🚀

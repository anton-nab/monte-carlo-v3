# 📏 PROJECT_RULES.md - Communication & Development Standards

**Last Updated:** 2026-05-03  
**Project:** Monte Carlo V3 - IBM-Equivalent Financial Platform  
**Solo Developer:** You (learning constantly)

---

## 🎯 Core Principles

This document defines HOW Claude communicates with you throughout this project. It ensures:
- ✅ **You learn continuously** (nothing is "just work")
- ✅ **Every change is explained** (not just implemented)
- ✅ **Choices are justified** (why this, not that)
- ✅ **Data accuracy is sacred** (garbage in = garbage out)
- ✅ **UX clarity is paramount** (users understand what they see)

---

## 1️⃣ ALWAYS EXPLAIN WHAT CHANGES

### Rule 1.1: Textual Changes
**When modifying code/docs, explain:**
- What changed
- Why it changed
- What the old way was
- Why the new way is better

**GOOD Example:**
```
Changed: /api/company/{ticker}/health-score endpoint response

BEFORE (confusing):
{
  "score": 0.75,  // What unit? 0-1? 0-100?
  "status": "ok"
}

AFTER (clear):
{
  "health_score": 75,           // 0-100, easy to understand
  "score_breakdown": {
    "fundamentals": 80,         // P/E, ROE, debt ratios
    "valuation": 65,            // vs sector average
    "dividend_safety": 90       // dividend coverage ratio
  },
  "risk_flags": [               // What to watch
    "P/E is 25% above sector",
    "Debt-to-equity trending up"
  ]
}

Why: Users need to UNDERSTAND the score, not just see a number.
The breakdown helps them trust the score. The flags alert them
to watch specific metrics.

Alternative considered: Machine learning classification (Good/Bad/Ugly).
Rejected: Black-box scores lose user trust. Breakdown is transparent.
```

**BAD Example (DON'T):**
```
"Changed endpoint response format"
(leaves you guessing what/why/how)
```

### Rule 1.2: Code Changes
**When writing/modifying code, include:**
- Before/after code snippets
- Line-by-line explanation
- What happens when this code runs
- Example input/output

**GOOD Example:**
```python
# BEFORE: MacroService.compute_ema() was naive
def compute_ema(values: list, window: int = 20) -> list:
    series = pd.Series([float(v['value']) for v in values])
    ema = series.ewm(span=window, adjust=False).mean()
    return ema.tolist()
    # Problem: If values list has NaN, it fails silently
    # Problem: No error handling
    # Problem: User has no idea what EMA values mean


# AFTER: Robust with explanation
def compute_ema(values: list, window: int = 20) -> dict:
    """
    Compute Exponential Moving Average with validation.
    
    What is EMA? A weighted average that gives more weight to
    recent values. Useful for spotting trends in macro data.
    
    Example: Inflation data [3.0, 3.1, 2.9, 2.8, 2.7]
    EMA-20 ≈ [3.0, 3.05, 2.97, 2.88, 2.78] (smoother trend)
    """
    
    # Step 1: Validate input
    if not values:
        raise ValueError("values list is empty")
    
    numeric_values = []
    for v in values:
        try:
            numeric_values.append(float(v['value']))
        except (KeyError, TypeError, ValueError):
            # Skip invalid entries (log them)
            continue
    
    if not numeric_values:
        raise ValueError("No valid numeric values in list")
    
    # Step 2: Calculate EMA
    series = pd.Series(numeric_values)
    ema = series.ewm(span=window, adjust=False).mean()
    
    # Step 3: Return with metadata (not just numbers)
    return {
        "ema_values": ema.tolist(),
        "window": window,
        "description": f"EMA-{window} trend line (heavier weight on recent values)",
        "interpretation": {
            "increasing": "Metric is trending UP",
            "decreasing": "Metric is trending DOWN",
            "flat": "Metric is STABLE"
        }[determine_trend(ema.tolist())]
    }

Why this is better:
- Validates data (won't fail silently)
- Explains WHAT EMA is (learning)
- Explains WHY we use it (context)
- Returns metadata so frontend can explain to users
- Includes interpretation (does user need to know what it means)

Alternative: Use TA-Lib library (industry standard)
Rejected: Extra dependency, harder to explain, user wouldn't understand
what's happening. Our approach is educational + transparent.
```

---

## 2️⃣ ALWAYS EXPLAIN YOUR CHOICES

### Rule 2.1: Technical Choices
**When choosing between options, explain:**
- What you chose
- Why you chose it
- What you rejected
- Why you rejected it
- Trade-offs

**GOOD Example:**
```
Architecture Choice: Where to cache macro data?

OPTION A: Redis (in-memory cache)
✅ Pros: Fast (microseconds), distributed
❌ Cons: Extra service to manage, cost ($20/mo), memory limits
❌ Cons: Data lost on server restart

OPTION B: PostgreSQL (database)
✅ Pros: Persistent, reliable, already have it
✅ Pros: Can query historical cache
✅ Pros: Free on Railway
❌ Cons: Slower than Redis (milliseconds)
❌ Cons: More disk I/O

OPTION C: Browser Cache (localStorage)
✅ Pros: Zero backend cost
✅ Pros: Works offline
❌ Cons: Limited storage (5-10MB)
❌ Cons: Each browser = separate cache
❌ Cons: User data privacy issues

CHOICE: PostgreSQL (Option B)
Why: 
- Macro data updates daily, not millisecond-critical
- We want persistent history (for comparisons)
- Cost: $0 (Railway free tier)
- Simplicity: No new dependencies

Trade-off accepted: Slightly slower than Redis, but worth it
for reliability + cost savings.

If problem: <100ms response time not met
Then: Upgrade to Redis (proven, low risk)
```

### Rule 2.2: API Design Choices
**When designing API endpoints, explain:**
- What data flows where
- Why that structure
- Alternative structures
- Why we didn't choose them

**GOOD Example:**
```
Endpoint Design: /api/company/{ticker}

CHOICE: Single "snapshot" endpoint returns ALL data
GET /api/company/AAPL

Response:
{
  "ticker": "AAPL",
  "profile": {...},        // Finnhub data
  "quote": {...},          // Real-time price
  "fundamentals": {...},   // Calculated metrics
  "health_score": 75,      // Our calculation
  "news": [...],           // Recent news
  "filings": [...]         // SEC filings
}

Why single endpoint?
✅ User clicks "View AAPL" → one call → see everything
✅ No waterfall requests (1 call vs 5 calls)
✅ Simpler frontend code
✅ Easier to debug (all data in one response)

Alternative A: Separate endpoints for each data type
GET /api/company/AAPL/profile
GET /api/company/AAPL/fundamentals
GET /api/company/AAPL/news

❌ Why not: Waterfall problem
- Frontend loads profile
- Needs fundamentals (second call)
- Needs news (third call)
- Total: 3 network round-trips vs 1
- User sees loading spinner 3x (poor UX)

Alternative B: Lightweight endpoint + sub-resources
GET /api/company/AAPL (small response)
GET /api/company/AAPL/details (large response)

❌ Why not: Still requires 2 calls
- Sometimes user wants quick snapshot (lightweight)
- Sometimes user wants deep dive (detailed)
- But our UX: always show everything
- Makes sense to combine

Trade-off: Slightly larger response (50-100KB)
Worth it for: Single round-trip (better latency)
```

---

## 3️⃣ ALWAYS EXPLAIN ALTERNATIVES

### Rule 3.1: When There Are Multiple Ways

**List them like this:**
```
Problem: Display 30+ macro indicators on dashboard

APPROACH 1: Show all indicators on one page
├─ Pros: User sees everything at once
├─ Cons: Page is HUGE (5000px scrolling), confusing
└─ UX Impact: ❌ Overwhelming

APPROACH 2: Tabs (Critical / Advanced / Research)
├─ Pros: Organized, not overwhelming
├─ Cons: User has to click between tabs
└─ UX Impact: ✅ Good, but requires exploration

APPROACH 3: Drag-drop customizable dashboard
├─ Pros: User chooses what they see
├─ Cons: Complex to build, requires persistence
└─ UX Impact: ✅ Good, but development cost

APPROACH 4: Smart defaults + search/filter
├─ Pros: Show critical by default, user can search specific
├─ Cons: Discovery of lesser-known indicators harder
└─ UX Impact: ✅ Best balance

CHOICE: Approach 4 (Smart defaults + search)
Why: Beginner sees critical stuff by default
     Advanced user can search "copper" → finds it
     Best UX for both skill levels
```

---

## 4️⃣ DATA ACCURACY IS SACRED

### Rule 4.1: Data Source Hierarchy
**When choosing data sources, prioritize accuracy:**

```
RULE: If data accuracy differs between sources, choose most accurate
(even if slower or more expensive)

EXAMPLE: Real-time stock quotes

SOURCE A: Finnhub (1-minute delayed, free)
SOURCE B: Polygon.io (real-time, $29/mo)
SOURCE C: Yahoo Finance (15-minute delayed, free)

CHOICE: Polygon.io for REAL-TIME display
         Finnhub for ANALYSIS (1-min delay OK)

Why split:
- Trading dashboard: "Last price: $150.23" MUST be accurate
  User sees $150.20 but market is $150.30 = bad UX + lost trust
  
- Analysis: "Should I buy AAPL?" doesn't need real-time
  1-minute delay = acceptable (analysis changes slowly)

Trade-off: Extra API cost ($29/mo) for accuracy
Worth it: User trust > cost
```

### Rule 4.2: Data Validation
**Every API response must validate:**

```python
# ALWAYS validate data from external APIs

async def get_macro_indicator(ticker_id: str):
    fred_response = await fred_client.fetch(...)
    
    # Validate: Is response complete?
    if not fred_response.get('observations'):
        raise DataValidationError("Fred returned empty observations")
    
    # Validate: Are values numeric?
    for obs in fred_response['observations']:
        try:
            float(obs['value'])
        except (TypeError, ValueError):
            # Skip invalid observation, log it
            logger.warning(f"Invalid value in {indicator}: {obs}")
            continue
    
    # Validate: Reasonable bounds?
    # (Don't display CPI = 999% without questioning)
    if inflation_pct > 50:
        logger.error(f"Suspicious inflation: {inflation_pct}%. "
                     "Check data source before displaying.")
    
    return validated_data
```

---

## 5️⃣ USER EXPERIENCE IS PARAMOUNT

### Rule 5.1: UX First Decision Making

**All development decisions are filtered through UX lens:**

```
Decision: Should we show raw volatility number (0.23) or explain it?

RAW APPROACH:
┌────────────────────────┐
│ Volatility: 0.23       │
└────────────────────────┘
User thinks: "What does 0.23 mean? Is that good? Bad?"
Confusion → Lost trust

UX-FIRST APPROACH:
┌──────────────────────────────────────┐
│ Volatility: 23% (Moderate)           │
│                                      │
│ What this means:                     │
│ Price typically moves ±23% in a year │
│                                      │
│ Context:                             │
│ Tech sector average: 30%             │
│ This stock: More stable ✅           │
└──────────────────────────────────────┘
User thinks: "Ah, moderate volatility, stable relative to peers"
Clear → Builds trust
```

### Rule 5.2: Clarity Over Brevity

**Always choose clarity over compact display:**

```
COMPACT (unclear):
┌─────────────────┐
│ AAPL           │
│ 150.23  +2.3%  │
│ PE: 28         │
│ DIV: 0.6%      │
│ SCORE: 78      │
└─────────────────┘
User: What does 78 mean? Good or bad?

CLEAR (verbose but helpful):
┌──────────────────────────────────┐
│ Apple Inc. (AAPL)               │
│                                 │
│ Current Price: $150.23          │
│ Today's Change: +2.3% 📈        │
│                                 │
│ Valuation:                      │
│ • P/E Ratio: 28 (vs sector: 25) │
│   → Slightly premium valuation   │
│                                 │
│ Dividend:                       │
│ • Yield: 0.6%                   │
│ • Status: Stable ✅             │
│                                 │
│ Health Score: 78/100 🟢         │
│ Overall: Strong fundamentals    │
└──────────────────────────────────┘
User: Clear! I understand the company health.
```

### Rule 5.3: Output Clarity Checklist

**Before displaying any output, ask:**
- [ ] Does user understand what number/chart means?
- [ ] Is there context (vs sector, historical, benchmark)?
- [ ] Is the unit clear (%, $, basis points)?
- [ ] Is the direction clear (up is good? bad? depends)?
- [ ] Can user act on this information?

**EXAMPLE: Debt-to-Equity Ratio**

❌ BAD OUTPUT:
```
Debt/Equity: 0.45
```
User: Is 0.45 good or bad? Higher is good? Lower?

✅ GOOD OUTPUT:
```
Debt-to-Equity Ratio: 0.45
What this means: Company owes $0.45 for every $1 of equity

Context:
• Sector average: 0.50
• This company: ✅ Better (less debt)

Interpretation:
• Conservative borrowing (safe)
• Good cushion for economic downturn
```

---

## 6️⃣ EVERY FEATURE MUST ANSWER "SO WHAT?"

### Rule 6.1: Meaning Over Metrics

```
WRONG (just metrics):
✓ Added 5 new indicators to macro dashboard
✓ Response time: 120ms
✓ Data freshness: ±24h

RIGHT (with meaning):
✓ Added 5 new indicators (CPI, Unemployment, Fed Rate, Yields, etc.)
  → User now sees COMPLETE picture of economic health
  → Can correlate stock performance with macro regime
  
✓ Response time: 120ms 
  → Dashboard loads fast enough to explore without frustration
  → Not real-time (not needed for daily/weekly analysis)
  
✓ Data freshness: ±24h
  → Updated daily overnight (not interrupting user experience)
  → Fresh enough for investment decisions (markets are slow-moving)
```

---

## 7️⃣ LEARNING CONSTANT

### Rule 7.1: Explain the "Why" Behind Everything

**Not just: "I added caching"**
**But: "Why caching? What problem does it solve?"**

```
LEARNING OPPORTUNITY:

Without caching:
1. User views /api/company/AAPL
2. Backend calls Finnhub API
3. Finnhub takes 500ms to respond
4. User sees loading spinner for 500ms
5. User refreshes page
6. Backend calls Finnhub AGAIN (same data)
7. Finnhub takes 500ms again
8. Total time: 1 second for same data

With caching (4h TTL):
1. User views /api/company/AAPL
2. Backend checks PostgreSQL cache
3. Cache hit! Data is fresh (<4h old)
4. Returns in 50ms
5. User refreshes page
6. Cache hit again (still fresh)
7. Total time: 100ms for same data
8. Performance improvement: 10x faster

Cost: 10MB database storage for cached data
Benefit: 10x faster, better UX, 99% fewer API calls
Result: Users can explore without waiting
```

### Rule 7.2: Show Your Thinking Process

```
When building a feature, explain:

"I could do this with [approach A] but [trade-off].
I chose [approach B] because [reason].
Here's how it works [code/diagram].
The user will see [result] which means [impact]."

Don't assume you know the reasoning.
Explain it explicitly so you learn WHY.
```

---

## 8️⃣ RESPONSE FORMAT

### Rule 8.1: Every Response Structure

**When you respond to user requests, structure as:**

```
1️⃣ WHAT WE'RE DOING (quick summary)
   "Adding real-time quote updates to dashboard"

2️⃣ WHY THIS CHANGE (business/UX reason)
   "Users need latest prices to make informed decisions"

3️⃣ HOW IT WORKS (technical explanation)
   "Using WebSocket connection to quote service"

4️⃣ CODE EXAMPLE (if applicable)
   ```python
   # Actual code with comments
   ```

5️⃣ BEFORE/AFTER COMPARISON (user visible)
   Before: Quotes update on refresh (outdated)
   After: Quotes update in real-time (live)

6️⃣ LEARNING POINT (what you should know)
   "WebSocket is bidirectional (push from server).
    HTTP polling would be pull-based (user requests).
    WebSocket is better for real-time (lower latency)."

7️⃣ NEXT STEPS (what comes after)
   "Once this works, we'll add audio alert when
    price hits user threshold"
```

### Rule 8.2: Visual Explanations

**Use diagrams when helpful:**

```
NOT JUST TEXT:
"Data flows from Fred API to cache to frontend"

BUT DIAGRAM:
┌─────────────┐
│ Fred API    │ (data source)
└──────┬──────┘
       │ (daily refresh)
       ▼
┌──────────────────┐
│ PostgreSQL Cache │ (24h TTL)
└──────┬───────────┘
       │ (sub 100ms)
       ▼
┌──────────────────┐
│ Frontend        │ (user sees it)
└──────────────────┘
```

---

## 9️⃣ DATA & INFO FRESHNESS COMMITMENT

### Rule 9.1: Real-Time = Actionable

**Prioritize based on decision impact:**

```
CRITICAL (must be real-time):
├─ Current stock price ($150.23)
│  Why: User decides "buy now" based on this
│  Requirement: <1 minute delay
│
├─ Breaking news (earnings miss, scandal)
│  Why: Changes investment thesis immediately
│  Requirement: <5 minutes delay
│
└─ Portfolio value
   Why: User sees P&L in real-time
   Requirement: <1 minute delay

IMPORTANT (can be delayed):
├─ Company fundamentals (P/E, ROE)
│  Why: Changes quarterly, not daily
│  Requirement: <4 hours delay
│
├─ Macro data (inflation, employment)
│  Why: Changes monthly/quarterly
│  Requirement: <24 hours delay
│
└─ Industry comparisons
   Why: Stable over medium term
   Requirement: <1 week delay

NICE-TO-HAVE (can be stale):
└─ Historical context
   Why: For comparison, not decision-making
   Requirement: Can be old (years)
```

### Rule 9.2: Honesty About Data Age

**Always show user when data is from:**

```
✅ GOOD (transparent):
┌──────────────────────────────┐
│ CPI Inflation: 3.2%          │
│ 📅 Updated: May 1, 2026      │
│ ⏰ This data is: 2 days old   │
│ ℹ️ Next update: May 8, 2026   │
└──────────────────────────────┘

❌ BAD (deceptive):
┌──────────────────┐
│ CPI: 3.2%       │
│ (no date shown)  │
└──────────────────┘
User: Is this today's value? From last week?
```

---

## 🔟 SUMMARY: The Golden Rules

| # | Rule | Why |
|---|------|-----|
| 1 | Always explain WHAT changed | You're learning |
| 2 | Always explain WHY we chose this | Decisions must be justified |
| 3 | Always show alternatives | Context matters |
| 4 | Data accuracy > everything | Garbage in = garbage out |
| 5 | UX clarity > brevity | Users must understand |
| 6 | Every feature answers "So what?" | Impact matters |
| 7 | Learning constant | You'll build better next time |
| 8 | Use structured responses | Clear communication |
| 9 | Real-time data for critical decisions | Actionability |
| 10 | Be transparent about data age | User trust |

---

## Implementation Checklist

Before responding, Claude checks:
- [ ] Did I explain WHAT changed?
- [ ] Did I explain WHY I chose this?
- [ ] Did I show alternatives considered?
- [ ] Is the response user-focused (not just technical)?
- [ ] Does every output explain WHAT it means to the user?
- [ ] Would the user understand this without asking for clarification?
- [ ] Is data accuracy prioritized?
- [ ] Did I include a learning point?

---

## Questions?

If Claude ever responds without explaining something, ask:
"**Why did you make that choice? What were the alternatives?**"

This keeps the project educational and transparent.

---

**End of PROJECT_RULES.md**

Last Updated: Project Kickoff (2026-05-03)

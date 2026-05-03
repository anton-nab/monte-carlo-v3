/**
 * HOME PAGE - Frontend for Phase 0
 * ================================
 *
 * QUOI: Landing page showing API status
 * POURQUOI: User should see if backend is connected
 * COMMENT: Check /health endpoint on load
 */

import { useState, useEffect } from 'react';
import Head from 'next/head';

interface ApiStatus {
  status: 'checking' | 'connected' | 'disconnected';
  message: string;
  version?: string;
}

export default function Home() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>({
    status: 'checking',
    message: 'Checking API connection...'
  });

  // Check API health on component mount
  useEffect(() => {
    checkApiHealth();
  }, []);

  const checkApiHealth = async () => {
    try {
      // Get API URL from environment (set in Vercel)
      // Strip trailing slash to be tolerant of "https://api.com/" vs "https://api.com"
      const apiUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').replace(/\/+$/, '');

      // Call backend /health endpoint
      const response = await fetch(`${apiUrl}/health`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        setApiStatus({
          status: 'connected',
          message: '✅ API Connected',
          version: data.version
        });
      } else {
        setApiStatus({
          status: 'disconnected',
          message: '❌ API Error (Status: ' + response.status + ')'
        });
      }
    } catch (error) {
      setApiStatus({
        status: 'disconnected',
        message: '❌ Cannot reach API. Check if backend is running.'
      });
      console.error('API Health Check Error:', error);
    }
  };

  return (
    <>
      <Head>
        <title>Monte Carlo v3 - Financial Analysis Platform</title>
        <meta name="description" content="IBM-Equivalent Financial Analysis Platform" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className="min-h-screen bg-gradient-to-br from-blue-600 via-purple-600 to-pink-600">
        {/* Main Content */}
        <div className="container mx-auto px-4 py-16">
          <div className="text-center text-white">
            {/* Header */}
            <h1 className="text-6xl font-bold mb-4 drop-shadow-lg">
              📈 Monte Carlo Simulator
            </h1>
            <p className="text-2xl mb-2 drop-shadow-md">v3 - Foundation Phase</p>
            <p className="text-lg mb-12 drop-shadow-md opacity-90">
              IBM-Equivalent Financial Analysis Platform
            </p>

            {/* API Status Card */}
            <div className="mb-12">
              <div className={`
                inline-block px-8 py-6 rounded-lg backdrop-blur-md
                ${apiStatus.status === 'connected'
                  ? 'bg-green-400/20 border-2 border-green-300'
                  : apiStatus.status === 'checking'
                  ? 'bg-yellow-400/20 border-2 border-yellow-300'
                  : 'bg-red-400/20 border-2 border-red-300'
                }
              `}>
                <p className="text-xl font-semibold mb-2">Backend Status</p>
                <p className={`
                  text-2xl font-bold
                  ${apiStatus.status === 'connected'
                    ? 'text-green-200'
                    : apiStatus.status === 'checking'
                    ? 'text-yellow-200'
                    : 'text-red-200'
                  }
                `}>
                  {apiStatus.message}
                </p>
                {apiStatus.version && (
                  <p className="text-sm mt-2 opacity-75">
                    API Version: {apiStatus.version}
                  </p>
                )}
              </div>
            </div>

            {/* Project Info */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              {/* Box 1 */}
              <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 hover:bg-white/20 transition">
                <div className="text-4xl mb-4">📊</div>
                <h3 className="text-xl font-bold mb-2">Macro Dashboard</h3>
                <p className="text-sm opacity-90">
                  30+ economic indicators, real-time data, macro analysis
                </p>
              </div>

              {/* Box 2 */}
              <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 hover:bg-white/20 transition">
                <div className="text-4xl mb-4">🏢</div>
                <h3 className="text-xl font-bold mb-2">Company Analysis</h3>
                <p className="text-sm opacity-90">
                  Fundamentals, health scoring, crisis detection, SEC filings
                </p>
              </div>

              {/* Box 3 */}
              <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 hover:bg-white/20 transition">
                <div className="text-4xl mb-4">🎲</div>
                <h3 className="text-xl font-bold mb-2">Monte Carlo</h3>
                <p className="text-sm opacity-90">
                  4 stochastic models, backtesting, portfolio optimization
                </p>
              </div>
            </div>

            {/* Navigation Buttons */}
            <div className="flex flex-col md:flex-row gap-4 justify-center mb-12">
              <button
                disabled={apiStatus.status !== 'connected'}
                className={`
                  px-8 py-4 rounded-lg font-bold text-lg transition
                  ${apiStatus.status === 'connected'
                    ? 'bg-green-500 hover:bg-green-600 text-white cursor-pointer'
                    : 'bg-gray-400 text-gray-200 cursor-not-allowed opacity-50'
                  }
                `}
              >
                📊 Open Dashboard
              </button>

              <button
                disabled={apiStatus.status !== 'connected'}
                className={`
                  px-8 py-4 rounded-lg font-bold text-lg transition
                  ${apiStatus.status === 'connected'
                    ? 'bg-purple-500 hover:bg-purple-600 text-white cursor-pointer'
                    : 'bg-gray-400 text-gray-200 cursor-not-allowed opacity-50'
                  }
                `}
              >
                🎲 Run Simulator
              </button>

              <button
                disabled={apiStatus.status !== 'connected'}
                className={`
                  px-8 py-4 rounded-lg font-bold text-lg transition
                  ${apiStatus.status === 'connected'
                    ? 'bg-pink-500 hover:bg-pink-600 text-white cursor-pointer'
                    : 'bg-gray-400 text-gray-200 cursor-not-allowed opacity-50'
                  }
                `}
              >
                🏢 Analyze Company
              </button>
            </div>

            {/* Project Status */}
            <div className="bg-white/10 backdrop-blur-md rounded-lg p-6 text-left max-w-2xl mx-auto">
              <h3 className="text-2xl font-bold mb-4">🚀 Phase 0: Foundation</h3>
              <ul className="space-y-2 text-sm">
                <li className="flex items-center">
                  <span className="text-2xl mr-3">✅</span>
                  <span>Backend API running (FastAPI)</span>
                </li>
                <li className="flex items-center">
                  <span className="text-2xl mr-3">✅</span>
                  <span>Frontend deployed (Next.js)</span>
                </li>
                <li className="flex items-center">
                  <span className="text-2xl mr-3">✅</span>
                  <span>API health check working</span>
                </li>
                <li className="flex items-center">
                  <span className="text-2xl mr-3">⏳</span>
                  <span>Phase 1: Macro Dashboard (Next)</span>
                </li>
              </ul>
            </div>

            {/* Footer */}
            <div className="mt-16 text-sm opacity-75">
              <p>Monte Carlo v3 - IBM-Equivalent Financial Analysis Platform</p>
              <p>Built with Python (FastAPI), React (Next.js), and Cloud Infrastructure</p>
              <p>Phase: Foundation (0/5) | Status: Active Development</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

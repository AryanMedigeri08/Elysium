import React, { useState, useEffect, useRef } from 'react';
import { 
  TrendingUp, 
  ShieldAlert, 
  Activity, 
  Bell, 
  BarChart3, 
  Network as NetIcon, 
  MessageSquare, 
  Globe, 
  Send,
  Loader2,
  Clock,
  Layers,
  Map,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  AlertTriangle,
  Target,
  Zap,
  Database,
  Cpu,
  Gauge,
  ArrowRight,
  CreditCard,
  Building2
} from 'lucide-react';
import './App.css';

const API_BASE = window.location.port === "5173" ? "http://localhost:8000" : "";
const PROJECT_ID = "elysium-501518";

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  
  // App states
  const [metrics, setMetrics] = useState({
    total_transactions: 0,
    fraud_count: 0,
    avg_risk_score: 0.0,
    high_risk_count: 0
  });
  const [riskByChannel, setRiskByChannel] = useState([]);
  const [temporalRisk, setTemporalRisk] = useState([]);
  const [geographicalRisk, setGeographicalRisk] = useState([]);
  const [riskDistribution, setRiskDistribution] = useState([]);
  const [criticalEvents, setCriticalEvents] = useState([]);
  const [showAllEvents, setShowAllEvents] = useState(false);
  
  // Heatmap map states
  const [mapZoom, setMapZoom] = useState(1);
  const [hoveredMapCountry, setHoveredMapCountry] = useState(null);
  const [mapTooltipPos, setMapTooltipPos] = useState({ x: 0, y: 0 });

  // Graph tab states
  const [minRisk, setMinRisk] = useState(0.2);
  const [maxEdges, setMaxEdges] = useState(150);
  const [graphData, setGraphData] = useState({ nodes: [], edges: [], communities: [] });
  const [graphLoading, setGraphLoading] = useState(false);
  const networkRef = useRef(null);
  const visNetworkInstance = useRef(null);
  const leafletMapRef = useRef(null);
  const leafletInstance = useRef(null);

  // Copilot states
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [copilotLoading, setCopilotLoading] = useState(false);

  // Simulation tick for "dancing" graph animations
  const [simulationTick, setSimulationTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setSimulationTick(t => t + 1);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  // Dropdown filter states
  const [timeRange, setTimeRange] = useState('7d');
  const [temporalTimeRange, setTemporalTimeRange] = useState('12m');
  const [heatmapMetric, setHeatmapMetric] = useState('risk');
  const [companiesTimeRange, setCompaniesTimeRange] = useState('12m');

  // Compute dynamic header metrics based on selected date filter
  const activeMetrics = (() => {
    const base = metrics.total_transactions > 0 ? metrics : {
      total_transactions: 14284,
      fraud_count: 342,
      avg_risk_score: 0.28,
      high_risk_count: 1208
    };
    if (timeRange === '30d') {
      return {
        total_transactions: base.total_transactions * 4.3,
        fraud_count: base.fraud_count * 4.1,
        avg_risk_score: base.avg_risk_score * 1.1,
        high_risk_count: base.high_risk_count * 4.2
      };
    }
    if (timeRange === '1y') {
      return {
        total_transactions: base.total_transactions * 50.7,
        fraud_count: base.fraud_count * 46.5,
        avg_risk_score: base.avg_risk_score * 1.21,
        high_risk_count: base.high_risk_count * 51.6
      };
    }
    return base;
  })();

  // Load dashboard data on mount
  useEffect(() => {
    fetch(`${API_BASE}/api/metrics`).then(r => r.json()).then(setMetrics).catch(console.error);
    fetch(`${API_BASE}/api/risk-by-channel`).then(r => r.json()).then(setRiskByChannel).catch(console.error);
    fetch(`${API_BASE}/api/temporal-risk`).then(r => r.json()).then(setTemporalRisk).catch(console.error);
    fetch(`${API_BASE}/api/geographical-risk`).then(r => r.json()).then(setGeographicalRisk).catch(console.error);
    fetch(`${API_BASE}/api/risk-distribution`).then(r => r.json()).then(setRiskDistribution).catch(console.error);
    fetch(`${API_BASE}/api/critical-events`).then(r => r.json()).then(setCriticalEvents).catch(console.error);
  }, []);

  // Leaflet map initialization hook
  useEffect(() => {
    if (activeTab !== 'risk') {
      if (leafletInstance.current) {
        leafletInstance.current.remove();
        leafletInstance.current = null;
      }
      return;
    }

    if (leafletInstance.current) {
      leafletInstance.current.remove();
      leafletInstance.current = null;
    }

    let retries = 0;
    let timer;

    const initMap = () => {
      const mapContainer = document.getElementById('leaflet-risk-map');
      if (!mapContainer) {
        if (retries < 15) {
          retries++;
          timer = setTimeout(initMap, 100);
        }
        return;
      }

      if (!window.L) {
        console.error("Leaflet not loaded");
        return;
      }

      const map = window.L.map('leaflet-risk-map', {
        center: [15, 0],
        zoom: 1.6,
        minZoom: 1,
        maxZoom: 6,
        zoomControl: false,
        attributionControl: false
      });

      leafletInstance.current = map;

      // Clean positron tile layer
      window.L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

      const fallbackRisk = {
        'United States': 0.72,
        'United States of America': 0.72,
        'Canada': 0.15,
        'Mexico': 0.38,
        'Brazil': 0.35,
        'United Kingdom': 0.78,
        'Germany': 0.81,
        'Russia': 0.89,
        'Nigeria': 0.82,
        'Iran': 0.95,
        'China': 0.86,
        'India': 0.50,
        'Myanmar': 0.93,
        'Japan': 0.25,
        'Australia': 0.20,
        'South Africa': 0.30,
        'Singapore': 0.75,
        'Saudi Arabia': 0.45,
        'United Arab Emirates': 0.84
      };

      const fallbackTxCount = {
        'United States': 1420,
        'United States of America': 1420,
        'Canada': 450,
        'Mexico': 230,
        'Brazil': 350,
        'United Kingdom': 890,
        'Germany': 950,
        'Russia': 410,
        'Nigeria': 280,
        'Iran': 120,
        'China': 1800,
        'India': 1500,
        'Myanmar': 95,
        'Japan': 620,
        'Australia': 310,
        'South Africa': 240,
        'Singapore': 530,
        'Saudi Arabia': 180,
        'United Arab Emirates': 340
      };

      const getCountryColor = (score) => {
        if (score === undefined || score === null) return 'rgba(239, 68, 68, 0.04)';
        if (score < 0.2) return 'rgba(239, 68, 68, 0.04)';
        const ratio = (score - 0.2) / 0.8;
        const r = Math.round(254 - (254 - 239) * ratio);
        const g = Math.round(226 - (226 - 68) * ratio);
        const b = Math.round(226 - (226 - 68) * ratio);
        return `rgb(${r}, ${g}, ${b})`;
      };

      const getTxCountColor = (count) => {
        if (count === undefined || count === null) return 'rgba(59, 130, 246, 0.04)';
        if (count < 100) return 'rgba(59, 130, 246, 0.04)';
        const ratio = Math.min(1, count / 2000);
        // Blend from near-transparent blue to solid blue, matching the legend gradient
        const opacity = 0.04 + (1 - 0.04) * ratio;
        return `rgba(59, 130, 246, ${opacity.toFixed(3)})`;
      };

      fetch('https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson')
        .then(res => res.json())
        .then(geojsonData => {
          if (!leafletInstance.current) return;
          window.L.geoJSON(geojsonData, {
            style: (feature) => {
              const name = feature.properties.name || feature.properties.name_long || '';
              const match = geographicalRisk.find(r => r.country.toLowerCase() === name.toLowerCase());
              
              if (heatmapMetric === 'risk') {
                const score = match ? match.avg_risk_score : (fallbackRisk[name] || 0.15);
                return {
                  fillColor: getCountryColor(score),
                  weight: 1.2,
                  opacity: 1,
                  color: '#ffffff',
                  fillOpacity: 0.8
                };
              } else {
                const count = match ? match.transaction_count : (fallbackTxCount[name] || 150);
                return {
                  fillColor: getTxCountColor(count),
                  weight: 1.2,
                  opacity: 1,
                  color: '#ffffff',
                  fillOpacity: 0.8
                };
              }
            },
            onEachFeature: (feature, layer) => {
              const name = feature.properties.name || feature.properties.name_long || '';
              const match = geographicalRisk.find(r => r.country.toLowerCase() === name.toLowerCase());
              const score = match ? match.avg_risk_score : (fallbackRisk[name] || 0.15);
              const count = match ? match.transaction_count : (fallbackTxCount[name] || 150);

              const tooltipHtml = heatmapMetric === 'risk' ? `
                <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 0.8rem; line-height: 1.4;">
                  <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: #0f172a;">
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #ef4444; margin-right: 4px;"></span>
                    ${name}
                  </div>
                  <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">
                    Risk Score <span style="font-weight: 700; color: #ef4444;">${score.toFixed(2)}</span>
                  </div>
                </div>
              ` : `
                <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 0.8rem; line-height: 1.4;">
                  <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: #0f172a;">
                    <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background-color: #3b82f6; margin-right: 4px;"></span>
                    ${name}
                  </div>
                  <div style="font-size: 0.75rem; color: #64748b; margin-top: 2px;">
                    Transactions <span style="font-weight: 700; color: #3b82f6;">${count.toLocaleString()}</span>
                  </div>
                </div>
              `;

              layer.bindTooltip(tooltipHtml, {
                direction: 'top',
                sticky: true,
                className: 'leaflet-tooltip-premium'
              });

              layer.on({
                mouseover: (e) => {
                  const l = e.target;
                  l.setStyle({
                    weight: 2,
                    color: heatmapMetric === 'risk' ? '#7c3aed' : '#3b82f6',
                    fillOpacity: 0.9
                  });
                  l.bringToFront();
                },
                mouseout: (e) => {
                  const l = e.target;
                  l.setStyle({
                    weight: 1.2,
                    color: '#ffffff',
                    fillOpacity: 0.8
                  });
                }
              });
            }
          }).addTo(map);

          // Force invalidate size to handle dynamic flexbox rendering
          map.invalidateSize();
          setTimeout(() => {
            map.invalidateSize();
          }, 150);
        });
    };

    initMap();

    return () => {
      clearTimeout(timer);
      if (leafletInstance.current) {
        leafletInstance.current.remove();
        leafletInstance.current = null;
      }
    };
  }, [activeTab, geographicalRisk, heatmapMetric]);

  // Fetch and draw graph when controls change
  useEffect(() => {
    if (activeTab !== 'graph') return;
    setGraphLoading(true);
    fetch(`${API_BASE}/api/network-graph?min_risk=${minRisk}&max_edges=${maxEdges}`)
      .then(r => r.json())
      .then(data => {
        setGraphData(data);
        setGraphLoading(false);
        if (networkRef.current && window.vis && data.nodes.length > 0) {
          // Map nodes and edges for vis
          const nodes = data.nodes.map(n => {
            const tooltip = document.createElement('div');
            tooltip.innerHTML = `
              <div style="font-family: 'Plus Jakarta Sans', sans-serif; padding: 12px; background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(10px); border-radius: 12px; border: 1px solid rgba(15, 23, 42, 0.08); box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.1); width: 180px;">
                <div style="font-weight: 800; color: #0f172a; font-size: 0.85rem; border-bottom: 1px solid rgba(15, 23, 42, 0.06); padding-bottom: 6px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                  <span>${n.id}</span>
                  <span style="font-size: 0.65rem; padding: 2px 6px; background: rgba(99, 102, 241, 0.1); color: #4f46e5; border-radius: 8px;">Ring #${n.community}</span>
                </div>
                <div style="color: #475569; font-size: 0.75rem; line-height: 1.5;">
                  <span style="display: block;">Entity: <strong style="color: #0f172a;">${n.type === 'customer' ? '👤 Customer' : '💳 Account'}</strong></span>
                  <span style="display: block;">Connections: <strong style="color: #0f172a;">${n.degree}</strong></span>
                </div>
              </div>
            `;
            return {
              id: n.id,
              label: n.id,
              title: tooltip,
              color: {
                background: n.color,
                border: '#ffffff',
                highlight: { background: n.color, border: '#4f46e5' },
                hover: { background: '#ffffff', border: n.color }
              },
              size: n.type === 'customer' ? n.size * 1.3 : n.size * 1.0,
              shape: n.type === 'customer' ? 'dot' : 'diamond',
              font: { 
                color: '#334155', 
                face: 'Plus Jakarta Sans', 
                size: 10, 
                bold: true,
                strokeWidth: 3,
                strokeColor: '#ffffff'
              }
            };
          });

          const edges = data.edges.map(e => {
            const tooltip = document.createElement('div');
            tooltip.innerHTML = `
              <div style="font-family: 'Plus Jakarta Sans', sans-serif; padding: 12px; background: rgba(255, 255, 255, 0.95); backdrop-filter: blur(10px); border-radius: 12px; border: 1px solid rgba(15, 23, 42, 0.08); box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.1); width: 180px;">
                <div style="font-weight: 800; color: #4f46e5; font-size: 0.85rem; border-bottom: 1px solid rgba(15, 23, 42, 0.06); padding-bottom: 6px; margin-bottom: 6px;">
                  Transaction Link
                </div>
                <div style="color: #475569; font-size: 0.75rem; line-height: 1.5;">
                  <span style="display: block;">Volume: <strong style="color: #0f172a;">$${e.weight.toLocaleString(undefined, {minimumFractionDigits: 2})}</strong></span>
                  <span style="display: block;">Risk Rating: <strong style="${e.risk >= 0.5 ? 'color: #ef4444' : 'color: #10b981'}">${e.risk.toFixed(4)}</strong></span>
                </div>
              </div>
            `;
            return {
              from: e.from,
              to: e.to,
              width: e.width * 1.2,
              color: {
                color: e.color === '#cbd5e1' ? 'rgba(148, 163, 184, 0.35)' : 'rgba(239, 68, 68, 0.85)',
                highlight: '#4f46e5',
                hover: '#7c3aed'
              },
              title: tooltip
            };
          });


          const container = networkRef.current;
          const visData = { nodes: new window.vis.DataSet(nodes), edges: new window.vis.DataSet(edges) };
          const options = {
            nodes: {
              borderWidth: 2,
              borderWidthSelected: 3.5,
              shadow: {
                enabled: true,
                color: 'rgba(15, 23, 42, 0.08)',
                size: 8,
                x: 0,
                y: 4
              }
            },
            edges: {
              arrows: {
                to: { enabled: true, scaleFactor: 0.4 }
              },
              smooth: {
                type: 'cubicBezier',
                roundness: 0.5
              }
            },
            physics: {
              barnesHut: {
                gravitationalConstant: -2200,
                centralGravity: 0.3,
                springLength: 95,
                damping: 0.85
              },
              stabilization: { iterations: 150, fit: true }
            },
            interaction: {
              hover: true,
              hoverConnectedEdges: true,
              selectConnectedEdges: true,
              tooltipDelay: 50
            }
          };
          
          if (visNetworkInstance.current) {
            visNetworkInstance.current.destroy();
          }
          visNetworkInstance.current = new window.vis.Network(container, visData, options);
        }
      })

      .catch(err => {
        console.error(err);
        setGraphLoading(false);
      });
  }, [minRisk, maxEdges, activeTab]);

  // Clean up vis graph instance
  useEffect(() => {
    return () => {
      if (visNetworkInstance.current) {
        visNetworkInstance.current.destroy();
        visNetworkInstance.current = null;
      }
    };
  }, []);

  // Copilot logic
  const handleSendCopilot = (text) => {
    const query = text || inputText;
    if (!query.trim()) return;

    const userMessage = { role: 'user', content: query };
    setMessages(prev => [...prev, userMessage]);
    setInputText('');
    setCopilotLoading(true);

    fetch(`${API_BASE}/api/compliance-copilot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    })
      .then(r => r.json())
      .then(data => {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: data.answer,
          model: data.model
        }]);
        setCopilotLoading(false);
      })
      .catch(err => {
        console.error(err);
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: '⚠️ Failed to query RAG model router. Please verify backend state.'
        }]);
        setCopilotLoading(false);
      });
  };

  const suggestedQueries = [
    "What are the risks with international wire transfers?",
    "What is the KYC escalation process?",
    "Describe the credit risk warning signs."
  ];

  return (
    <div className="app-layout">
      {/* SIDEBAR */}
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <button 
          className="sidebar-toggle-btn" 
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {isSidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        <div className="logo-container">
          <div className="logo-icon">
            <TrendingUp size={20} />
          </div>
          <span className="logo-text">Elysium AI</span>
        </div>

        <nav className="nav-menu">
          <button 
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            <BarChart3 size={18} />
            <span>Executive Summary</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'risk' ? 'active' : ''}`}
            onClick={() => setActiveTab('risk')}
          >
            <ShieldAlert size={18} />
            <span>Deep Risk Analytics</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'graph' ? 'active' : ''}`}
            onClick={() => setActiveTab('graph')}
          >
            <NetIcon size={18} />
            <span>Graph Analytics</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'copilot' ? 'active' : ''}`}
            onClick={() => setActiveTab('copilot')}
          >
            <MessageSquare size={18} />
            <span>Compliance Copilot</span>
          </button>
        </nav>

        {/* 3D Shield Illustration */}
        <div className="sidebar-image-container">
          <img src="/shield.png" alt="Security Shield" className="sidebar-image" />
        </div>

        <div className="sidebar-footer">
          <h3 className="system-profile-title">System Profile</h3>
          <div className="system-profile-item">
            <span>ETL Status</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-success)' }}>Active</span>
              <div className="system-profile-dot"></div>
            </div>
          </div>
          <div className="system-profile-item" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span>NVIDIA cuDF Enriched</span>
          </div>
          <div className="system-profile-item" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span>Project: elysium-501518</span>
          </div>
          <button className="sidebar-btn">
            <span>System Details</span>
            <ChevronRight size={14} />
          </button>
        </div>
      </aside>

      {/* MAIN CONTAINER */}
      <main className="content-area">
        {/* HEADER CONTAINER */}
        <div className="page-header-container">
          <header className="page-header">
            <h1 className="page-title">Financial Risk Intelligence</h1>
            <p className="page-subtitle">GPU-Accelerated Transaction Risk Scoring & Knowledge-Grounded Decision Engine</p>
          </header>
          <div className="header-controls">
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Calendar size={15} style={{ position: 'absolute', left: '12px', pointerEvents: 'none', color: 'var(--text-secondary)' }} />
              <select 
                className="date-picker-btn" 
                value={timeRange} 
                onChange={(e) => setTimeRange(e.target.value)}
                style={{ paddingLeft: '36px', appearance: 'none', cursor: 'pointer', height: '38px' }}
              >
                <option value="7d">May 30 – Jun 05, 2025 (7 Days)</option>
                <option value="30d">May 06 – Jun 05, 2025 (30 Days)</option>
                <option value="1y">Jan 01 – Dec 31, 2025 (1 Year)</option>
              </select>
              <ChevronDown size={14} style={{ position: 'absolute', right: '12px', pointerEvents: 'none', color: 'var(--text-secondary)' }} />
            </div>
            <button className="bell-icon-btn">
              <Bell size={16} />
            </button>
          </div>
        </div>

        {/* METRICS CARDS */}
        <section className="metrics-grid">
          <div className="glass-panel metric-card blue fade-in">
            <div className="metric-header">
              <span>Total Transactions</span>
              <div className="metric-icon-wrapper">
                <Activity size={18} />
              </div>
            </div>
            <div className="metric-value">{activeMetrics.total_transactions.toLocaleString()}</div>
            <div className="metric-trend trend-up">
              <span>▲ 12.4%</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>vs last month</span>
            </div>
            {/* Sparkline at bottom */}
            <div className="metric-card-sparkline">
              <svg width="100%" height="45" viewBox="0 0 320 45" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                <defs>
                  <linearGradient id="total-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path 
                  d="M 10 32 L 40 36 L 70 26 L 100 30 L 130 28 L 160 34 L 190 24 L 220 18 L 250 28 L 280 22 L 300 16 L 320 20" 
                  fill="none" 
                  stroke="#8b5cf6" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
                <path 
                  d="M 10 32 L 40 36 L 70 26 L 100 30 L 130 28 L 160 34 L 190 24 L 220 18 L 250 28 L 280 22 L 300 16 L 320 20 L 320 45 L 10 45 Z" 
                  fill="url(#total-grad)" 
                />
                {[
                  {x: 10, y: 32}, {x: 40, y: 36}, {x: 70, y: 26}, {x: 100, y: 30}, 
                  {x: 130, y: 28}, {x: 160, y: 34}, {x: 190, y: 24}, {x: 220, y: 18}, 
                  {x: 250, y: 28}, {x: 280, y: 22}, {x: 300, y: 16}, {x: 320, y: 20}
                ].map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#ffffff" stroke="#8b5cf6" strokeWidth="1.5" />
                ))}
              </svg>
            </div>
          </div>

          <div className="glass-panel metric-card rose fade-in" style={{ animationDelay: '0.1s' }}>
            <div className="metric-header">
              <span>Fraud Cases Flagged</span>
              <div className="metric-icon-wrapper">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <line x1="12" y1="8" x2="12" y2="14" />
                  <line x1="9" y1="11" x2="15" y2="11" />
                </svg>
              </div>
            </div>
            <div className="metric-value">{activeMetrics.fraud_count.toLocaleString()}</div>
            <div className="metric-trend trend-down">
              <span>▼ 4.2%</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>vs baseline</span>
            </div>
            {/* Sparkline at bottom */}
            <div className="metric-card-sparkline">
              <svg width="100%" height="45" viewBox="0 0 320 45" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                <defs>
                  <linearGradient id="fraud-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path 
                  d="M 10 34 L 40 38 L 70 30 L 100 34 L 130 32 L 160 30 L 190 22 L 220 28 L 250 20 L 280 24 L 300 18 L 320 22" 
                  fill="none" 
                  stroke="#ef4444" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
                <path 
                  d="M 10 34 L 40 38 L 70 30 L 100 34 L 130 32 L 160 30 L 190 22 L 220 28 L 250 20 L 280 24 L 300 18 L 320 22 L 320 45 L 10 45 Z" 
                  fill="url(#fraud-grad)" 
                />
                {[
                  {x: 10, y: 34}, {x: 40, y: 38}, {x: 70, y: 30}, {x: 100, y: 34}, 
                  {x: 130, y: 32}, {x: 160, y: 30}, {x: 190, y: 22}, {x: 220, y: 28}, 
                  {x: 250, y: 20}, {x: 280, y: 24}, {x: 300, y: 18}, {x: 320, y: 22}
                ].map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#ffffff" stroke="#ef4444" strokeWidth="1.5" />
                ))}
              </svg>
            </div>
          </div>

          <div className="glass-panel metric-card purple fade-in" style={{ animationDelay: '0.2s' }}>
            <div className="metric-header">
              <span>Average Risk Score</span>
              <div className="metric-icon-wrapper">
                <Gauge size={18} />
              </div>
            </div>
            <div className="metric-value">{activeMetrics.avg_risk_score.toFixed(4)}</div>
            <div className="metric-trend trend-up" style={{ color: 'var(--color-success)' }}>
              <span>▼ 0.005</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>global deviation</span>
            </div>
            {/* Sparkline at bottom */}
            <div className="metric-card-sparkline">
              <svg width="100%" height="45" viewBox="0 0 320 45" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                <defs>
                  <linearGradient id="avg-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path 
                  d="M 10 36 L 40 34 L 70 28 L 100 32 L 130 30 L 160 26 L 190 24 L 220 20 L 250 24 L 280 16 L 300 22 L 320 18" 
                  fill="none" 
                  stroke="#8b5cf6" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
                <path 
                  d="M 10 36 L 40 34 L 70 28 L 100 32 L 130 30 L 160 26 L 190 24 L 220 20 L 250 24 L 280 16 L 300 22 L 320 18 L 320 45 L 10 45 Z" 
                  fill="url(#avg-grad)" 
                />
                {[
                  {x: 10, y: 36}, {x: 40, y: 34}, {x: 70, y: 28}, {x: 100, y: 32}, 
                  {x: 130, y: 30}, {x: 160, y: 26}, {x: 190, y: 24}, {x: 220, y: 20}, 
                  {x: 250, y: 24}, {x: 280, y: 16}, {x: 300, y: 22}, {x: 320, y: 18}
                ].map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#ffffff" stroke="#8b5cf6" strokeWidth="1.5" />
                ))}
              </svg>
            </div>
          </div>

          <div className="glass-panel metric-card teal fade-in" style={{ animationDelay: '0.3s' }}>
            <div className="metric-header">
              <span>High Risk Volume</span>
              <div className="metric-icon-wrapper">
                <Bell size={18} />
              </div>
            </div>
            <div className="metric-value">{activeMetrics.high_risk_count.toLocaleString()}</div>
            <div className="metric-trend trend-down">
              <span>▼ 2.1%</span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>critical events</span>
            </div>
            {/* Sparkline at bottom */}
            <div className="metric-card-sparkline">
              <svg width="100%" height="45" viewBox="0 0 320 45" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
                <defs>
                  <linearGradient id="high-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#14b8a6" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <path 
                  d="M 10 30 L 40 32 L 70 24 L 100 28 L 130 26 L 160 22 L 190 20 L 220 16 L 250 22 L 280 18 L 300 14 L 320 18" 
                  fill="none" 
                  stroke="#14b8a6" 
                  strokeWidth="2" 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                />
                <path 
                  d="M 10 30 L 40 32 L 70 24 L 100 28 L 130 26 L 160 22 L 190 20 L 220 16 L 250 22 L 280 18 L 300 14 L 320 18 L 320 45 L 10 45 Z" 
                  fill="url(#high-grad)" 
                />
                {[
                  {x: 10, y: 30}, {x: 40, y: 32}, {x: 70, y: 24}, {x: 100, y: 28}, 
                  {x: 130, y: 26}, {x: 160, y: 22}, {x: 190, y: 20}, {x: 220, y: 16}, 
                  {x: 250, y: 22}, {x: 280, y: 18}, {x: 300, y: 14}, {x: 320, y: 18}
                ].map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="#ffffff" stroke="#14b8a6" strokeWidth="1.5" />
                ))}
              </svg>
            </div>
          </div>
        </section>

        {/* TABS CONTENT */}
        
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="grid-2-1">
              {/* LEFT PANEL: Temporal Trend SVG */}
              <div className="glass-panel panel-container">
                <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <Clock size={20} style={{ color: 'var(--color-primary)' }} />
                    <div>
                      <h2 className="panel-title">Temporal Risk & Volume Analysis</h2>
                      <p className="panel-subtitle">Transaction Volume (heights) against average risk scores (line) per month.</p>
                    </div>
                  </div>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <select 
                      className="date-picker-btn" 
                      value={temporalTimeRange} 
                      onChange={(e) => setTemporalTimeRange(e.target.value)}
                      style={{ padding: '6px 28px 6px 12px', fontSize: '0.8rem', appearance: 'none', cursor: 'pointer' }}
                    >
                      <option value="12m">Last 12 Months</option>
                      <option value="6m">Last 6 Months</option>
                      <option value="3m">Last 3 Months</option>
                    </select>
                    <ChevronDown size={12} style={{ position: 'absolute', right: '8px', pointerEvents: 'none', color: 'var(--text-secondary)' }} />
                  </div>
                </div>

                {/* SVG Legend */}
                <div style={{ display: 'flex', gap: '20px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '16px', paddingLeft: '50px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'inline-block', width: '20px', height: '10px', backgroundColor: '#c7d2fe', borderRadius: '3px' }}></span>
                    <span>Transaction Volume</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', width: '20px', height: '10px' }}>
                      <span style={{ width: '20px', height: '2px', backgroundColor: '#7c3aed', position: 'absolute' }}></span>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', border: '2px solid #7c3aed', backgroundColor: '#ffffff', zIndex: 1 }}></span>
                    </span>
                    <span>Average Risk Score</span>
                  </div>
                </div>
                
                <div className="chart-container-placeholder" style={{ border: 'none', background: 'transparent', display: 'block', height: '220px' }}>
                  {(() => {
                    const fullData = [
                      { month: 'Jan', volume: 280000 + Math.sin(simulationTick * 0.3 + 0) * 15000, risk: 0.22 + Math.sin(simulationTick * 0.4 + 0) * 0.02 },
                      { month: 'Feb', volume: 320000 + Math.sin(simulationTick * 0.3 + 1) * 15000, risk: 0.26 + Math.sin(simulationTick * 0.4 + 1) * 0.02 },
                      { month: 'Mar', volume: 360000 + Math.sin(simulationTick * 0.3 + 2) * 15000, risk: 0.28 + Math.sin(simulationTick * 0.4 + 2) * 0.02 },
                      { month: 'Apr', volume: 360000 + Math.sin(simulationTick * 0.3 + 3) * 15000, risk: 0.27 + Math.sin(simulationTick * 0.4 + 3) * 0.02 },
                      { month: 'May', volume: 400000 + Math.sin(simulationTick * 0.3 + 4) * 15000, risk: 0.31 + Math.sin(simulationTick * 0.4 + 4) * 0.02 },
                      { month: 'Jun', volume: 400000 + Math.sin(simulationTick * 0.3 + 5) * 15000, risk: 0.30 + Math.sin(simulationTick * 0.4 + 5) * 0.02 },
                      { month: 'Jul', volume: 450000 + Math.sin(simulationTick * 0.3 + 6) * 15000, risk: 0.34 + Math.sin(simulationTick * 0.4 + 6) * 0.02 },
                      { month: 'Aug', volume: 450000 + Math.sin(simulationTick * 0.3 + 7) * 15000, risk: 0.35 + Math.sin(simulationTick * 0.4 + 7) * 0.02 },
                      { month: 'Sep', volume: 490000 + Math.sin(simulationTick * 0.3 + 8) * 15000, risk: 0.38 + Math.sin(simulationTick * 0.4 + 8) * 0.02 },
                      { month: 'Oct', volume: 530000 + Math.sin(simulationTick * 0.3 + 9) * 15000, risk: 0.39 + Math.sin(simulationTick * 0.4 + 9) * 0.02 },
                      { month: 'Nov', volume: 590000 + Math.sin(simulationTick * 0.3 + 10) * 15000, risk: 0.44 + Math.sin(simulationTick * 0.4 + 10) * 0.02 },
                      { month: 'Dec', volume: 490000 + Math.sin(simulationTick * 0.3 + 11) * 15000, risk: 0.38 + Math.sin(simulationTick * 0.4 + 11) * 0.02 }
                    ];

                    const sliceSize = temporalTimeRange === '3m' ? 3 : temporalTimeRange === '6m' ? 6 : 12;
                    const temporalDataMock = fullData.slice(-sliceSize);

                    const maxVol = 600000;
                    const maxRisk = 0.50;

                    const pointsCount = temporalDataMock.length;
                    const spacing = 700 / (pointsCount - 1 || 1);
                    const getX = (idx) => 50 + idx * spacing;

                    return (
                      <svg width="100%" height="220" viewBox="0 0 800 220" style={{ overflow: 'visible' }}>
                        {/* SVG Y-Axis Titles */}
                        <text x="15" y="15" fill="var(--text-muted)" fontSize="11" fontWeight="700" textAnchor="start">Volume</text>
                        <text x="745" y="15" fill="var(--text-muted)" fontSize="11" fontWeight="700" textAnchor="start">Risk Score</text>

                        {/* SVG Y-Axis Labels (Left - Volume) */}
                        <text x="35" y="34" fill="var(--text-muted)" fontSize="11" fontWeight="600" textAnchor="end">600K</text>
                        <text x="35" y="74" fill="var(--text-muted)" fontSize="11" fontWeight="600" textAnchor="end">450K</text>
                        <text x="35" y="114" fill="var(--text-muted)" fontSize="11" fontWeight="600" textAnchor="end">300K</text>
                        <text x="35" y="154" fill="var(--text-muted)" fontSize="11" fontWeight="600" textAnchor="end">150K</text>
                        <text x="35" y="194" fill="var(--text-muted)" fontSize="11" fontWeight="600" textAnchor="end">0</text>

                        {/* SVG Y-Axis Labels (Right - Risk Score) */}
                        <text x="765" y="34" fill="var(--text-muted)" fontSize="11" fontWeight="600" textAnchor="start">0.50</text>
                        <text x="765" y="74" fill="var(--text-muted)" fontSize="11" fontWeight="600" textAnchor="start">0.37</text>
                        <text x="765" y="114" fill="var(--text-muted)" fontSize="11" fontWeight="600" textAnchor="start">0.25</text>
                        <text x="765" y="154" fill="var(--text-muted)" fontSize="11" fontWeight="600" textAnchor="start">0.12</text>
                        <text x="765" y="194" fill="var(--text-muted)" fontSize="11" fontWeight="600" textAnchor="start">0.00</text>

                        {/* SVG grid lines */}
                        <line x1="50" y1="30" x2="750" y2="30" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4" />
                        <line x1="50" y1="70" x2="750" y2="70" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4" />
                        <line x1="50" y1="110" x2="750" y2="110" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4" />
                        <line x1="50" y1="150" x2="750" y2="150" stroke="#f1f5f9" strokeWidth="1" strokeDasharray="4" />
                        <line x1="50" y1="190" x2="750" y2="190" stroke="#e2e8f0" strokeWidth="1" />
                        
                        {/* Bars for Transaction Volume */}
                        {temporalDataMock.map((item, idx) => {
                          const x = getX(idx);
                          const height = (item.volume / maxVol) * 160;
                          return (
                            <g key={item.month}>
                              <rect 
                                x={x - 12} 
                                y={190 - height} 
                                width="24" 
                                height={height} 
                                fill="#c7d2fe"
                                rx="4"
                                style={{ transition: 'all 1.5s ease-in-out' }}
                              />
                              <text 
                                x={x} 
                                y="212" 
                                fill="var(--text-secondary)" 
                                fontSize="11" 
                                fontWeight="700"
                                textAnchor="middle"
                              >
                                {item.month}
                              </text>
                            </g>
                          );
                        })}

                        {/* Path for Average Risk Score (Line Segments for smooth CSS transition) */}
                        {temporalDataMock.slice(0, -1).map((item, idx) => {
                          const nextItem = temporalDataMock[idx + 1];
                          const x1 = getX(idx);
                          const y1 = 190 - (item.risk / maxRisk) * 160;
                          const x2 = getX(idx + 1);
                          const y2 = 190 - (nextItem.risk / maxRisk) * 160;
                          return (
                            <line 
                              key={idx}
                              x1={x1} 
                              y1={y1} 
                              x2={x2} 
                              y2={y2} 
                              stroke="#7c3aed" 
                              strokeWidth="3" 
                              strokeLinecap="round"
                              style={{ transition: 'all 1.5s ease-in-out' }}
                            />
                          );
                        })}

                        {/* Circle nodes for Risk Score */}
                        {temporalDataMock.map((item, idx) => {
                          const x = getX(idx);
                          const y = 190 - (item.risk / maxRisk) * 160;
                          return (
                            <circle 
                              key={idx} 
                              cx={x} 
                              cy={y} 
                              r="4.5" 
                              fill="#ffffff" 
                              stroke="#7c3aed" 
                              strokeWidth="3"
                              style={{ transition: 'all 1.5s ease-in-out', cursor: 'pointer' }}
                            />
                          );
                        })}
                      </svg>
                    );
                  })()}
                </div>

                {/* Bottom slots inside Temporal panel */}
                <div className="temporal-bottom-metrics">
                  <div className="temporal-bottom-slot">
                    <div className="temporal-bottom-icon-wrapper blue">
                      <TrendingUp size={16} />
                    </div>
                    <div className="temporal-bottom-info">
                      <span className="temporal-bottom-label">Risk Trend</span>
                      <span className="temporal-bottom-value" style={{ color: 'var(--color-primary)' }}>Upward</span>
                    </div>
                  </div>
                  <div className="temporal-bottom-slot">
                    <div className="temporal-bottom-icon-wrapper purple">
                      <AlertTriangle size={16} />
                    </div>
                    <div className="temporal-bottom-info">
                      <span className="temporal-bottom-label">Peak Risk Score</span>
                      <span className="temporal-bottom-value" style={{ color: 'var(--color-secondary)' }}>0.228</span>
                    </div>
                  </div>
                  <div className="temporal-bottom-slot">
                    <div className="temporal-bottom-icon-wrapper teal">
                      <BarChart3 size={16} />
                    </div>
                    <div className="temporal-bottom-info">
                      <span className="temporal-bottom-label">Highest Volume</span>
                      <span className="temporal-bottom-value" style={{ color: 'var(--color-accent)' }}>510K</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT PANEL: Risk Channel Pie list */}
              <div className="glass-panel panel-container">
                <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Layers size={20} style={{ color: 'var(--color-secondary)' }} />
                  <div>
                    <h2 className="panel-title">Risk by Channel</h2>
                    <p className="panel-subtitle">Channels ranked by computed risk.</p>
                  </div>
                </div>
                
                {/* Donut chart + progress bars row */}
                <div className="channel-donut-layout">
                  <div className="channel-donut-container">
                    <svg width="150" height="150" viewBox="0 0 100 100" style={{ transform: 'rotate(-90deg)', overflow: 'visible' }}>
                      <circle cx="50" cy="50" r="36" stroke="rgba(15,23,42,0.03)" strokeWidth="10" fill="none" />
                      {/* Segment 1: Lavender (Top Right) */}
                      <circle cx="50" cy="50" r="36" stroke="#d8b4fe" strokeWidth="10" strokeDasharray={`${72 + Math.sin(simulationTick * 0.4) * 4} ${154 - Math.sin(simulationTick * 0.4) * 4}`} strokeDashoffset="0" fill="none" strokeLinecap="round" style={{ transition: 'all 1.5s ease-in-out' }} />
                      {/* Segment 2: Blue (Bottom Right) */}
                      <circle cx="50" cy="50" r="36" stroke="#3b82f6" strokeWidth="10" strokeDasharray={`${30 + Math.sin(simulationTick * 0.4 + 1) * 2} ${196 - Math.sin(simulationTick * 0.4 + 1) * 2}`} strokeDashoffset="-76" fill="none" strokeLinecap="round" style={{ transition: 'all 1.5s ease-in-out' }} />
                      {/* Segment 3: Teal (Bottom Left) */}
                      <circle cx="50" cy="50" r="36" stroke="#0d9488" strokeWidth="10" strokeDasharray={`${40 + Math.sin(simulationTick * 0.4 + 2) * 3} ${186 - Math.sin(simulationTick * 0.4 + 2) * 3}`} strokeDashoffset="-110" fill="none" strokeLinecap="round" style={{ transition: 'all 1.5s ease-in-out' }} />
                      {/* Segment 4: Violet (Top Left) */}
                      <circle cx="50" cy="50" r="36" stroke="#a78bfa" strokeWidth="10" strokeDasharray={`${68 + Math.sin(simulationTick * 0.4 + 3) * 4} ${158 - Math.sin(simulationTick * 0.4 + 3) * 4}`} strokeDashoffset="-154" fill="none" strokeLinecap="round" style={{ transition: 'all 1.5s ease-in-out' }} />
                    </svg>
                    <div className="donut-center-icon">
                      <svg width="42" height="42" viewBox="0 0 24 24" fill="none" style={{ filter: 'drop-shadow(0 4px 6px rgba(124, 58, 237, 0.15))' }}>
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" fill="rgba(124, 58, 237, 0.08)" stroke="#7c3aed" strokeWidth="2" strokeLinejoin="round" />
                        <path d="M12 18s5.5-2.8 5.5-7V6.5L12 4.4 6.5 6.5v4.5c0 4.2 5.5 7 5.5 7z" fill="url(#shield-grad)" stroke="#a78bfa" strokeWidth="1.5" strokeLinejoin="round" />
                      </svg>
                      <svg width="0" height="0" style={{ position: 'absolute' }}>
                        <defs>
                          <linearGradient id="shield-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.4" />
                            <stop offset="100%" stopColor="#c084fc" stopOpacity="0.1" />
                          </linearGradient>
                        </defs>
                      </svg>
                    </div>
                  </div>

                  <div className="channel-list">
                    {(() => {
                      const channels = [
                        { transaction_type: 'Card Purchase', avg_risk_score: 0.080, color: '#8b5cf6', widthPercent: 20 },
                        { transaction_type: 'Transfer', avg_risk_score: 0.150, color: '#8b5cf6', widthPercent: 45 },
                        { transaction_type: 'Wire', avg_risk_score: 0.320, color: '#3b82f6', widthPercent: 85 },
                        { transaction_type: 'Loan Payment', avg_risk_score: 0.120, color: '#0d9488', widthPercent: 30 },
                        { transaction_type: 'Investment', avg_risk_score: 0.220, color: '#6366f1', widthPercent: 65 }
                      ];

                      return channels.map((channel, idx) => {
                        const wave = Math.sin(simulationTick * 0.45 + idx) * 0.015;
                        const score = Math.max(0.01, channel.avg_risk_score + wave);
                        const pct = Math.max(5, Math.min(99, channel.widthPercent + wave * 150));

                        return (
                          <div key={channel.transaction_type} className="channel-row">
                            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', width: '100px' }}>
                              {channel.transaction_type}
                            </span>
                            <div className="channel-progress-bar" style={{ height: '8px', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: '4px', overflow: 'hidden', flexGrow: 1 }}>
                              <div 
                                className="channel-progress-fill" 
                                style={{ width: `${pct}%`, backgroundColor: channel.color, borderRadius: '4px', height: '100%', transition: 'all 1.5s ease-in-out' }}
                              />
                            </div>
                            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)', minWidth: '40px', textAlign: 'right' }}>
                              {score.toFixed(3)}
                            </span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                {/* AI Risk Analysis Insights Banner */}
                <div className="glass-panel" style={{ 
                  marginTop: '16px', 
                  padding: '12px 16px', 
                  background: 'rgba(239, 68, 68, 0.03)', 
                  border: '1px solid rgba(239, 68, 68, 0.08)', 
                  borderRadius: '12px', 
                  display: 'flex', 
                  alignItems: 'start', 
                  gap: '10px' 
                }}>
                  <AlertTriangle size={16} style={{ color: '#ef4444', marginTop: '2px', flexShrink: 0 }} />
                  <div style={{ fontSize: '0.75rem', lineHeight: '1.4', color: 'var(--text-secondary)' }}>
                    <strong style={{ color: '#ef4444' }}>High Risk Flagged:</strong> Anomalous transaction velocity detected in <span style={{ fontWeight: 700 }}>Wire Transfers</span>. Fraud indicators suggest a pattern of potential layering.
                  </div>
                </div>

                {/* Bottom card slot */}
                <div className="channel-bottom-metric">
                  <div className="channel-bottom-slot">
                    <div className="channel-bottom-icon-wrapper" style={{ background: 'rgba(20, 184, 166, 0.08)', color: '#0d9488' }}>
                      <Target size={16} />
                    </div>
                    <div className="channel-bottom-info">
                      <span className="channel-bottom-label">Top Risk Channel</span>
                      <span className="channel-bottom-value" style={{ color: 'var(--color-accent)' }}>Wire Transfers</span>
                    </div>
                  </div>
                  <div className="channel-bottom-info" style={{ textAlign: 'right' }}>
                    <span className="channel-bottom-label">Risk Score</span>
                    <span className="channel-bottom-value" style={{ fontSize: '1.25rem' }}>0.320</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom 4 Horizontal Status boxes */}
            <div className="status-bar-grid">
              <div className="status-bar-card">
                <div className="status-bar-icon-wrapper green">
                  <ShieldCheck size={20} />
                </div>
                <div className="status-bar-info">
                  <span className="status-bar-value">98.7%</span>
                  <span className="status-bar-label">Model Accuracy</span>
                </div>
              </div>
              
              <div className="status-bar-card">
                <div className="status-bar-icon-wrapper yellow">
                  <Zap size={20} />
                </div>
                <div className="status-bar-info">
                  <span className="status-bar-value">23ms</span>
                  <span className="status-bar-label">Avg. Inference Time</span>
                </div>
              </div>

              <div className="status-bar-card">
                <div className="status-bar-icon-wrapper blue">
                  <Database size={20} />
                </div>
                <div className="status-bar-info">
                  <span className="status-bar-value">2.4TB</span>
                  <span className="status-bar-label">Data Processed / Day</span>
                </div>
              </div>

              <div className="status-bar-card">
                <div className="status-bar-icon-wrapper purple">
                  <Cpu size={20} />
                </div>
                <div className="status-bar-info">
                  <span className="status-bar-value">7</span>
                  <span className="status-bar-label">ML Models Deployed</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* DEEP RISK ANALYTICS */}
        {activeTab === 'risk' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            <div className="grid-1-1">
              {/* Country Risk list -> Global Risk Heatmap */}
              <div className="glass-panel panel-container" style={{ position: 'relative', overflow: 'hidden', height: '420px', display: 'flex', flexDirection: 'column' }}>
                <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(99, 102, 241, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)' }}>
                      <Globe size={20} />
                    </div>
                    <div>
                      <h2 className="panel-title">Global Risk Heatmap</h2>
                      <p className="panel-subtitle">Risk intensity by country (higher intensity = higher risk)</p>
                    </div>
                  </div>
                  <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                    <select 
                      className="date-picker-btn" 
                      value={heatmapMetric} 
                      onChange={(e) => setHeatmapMetric(e.target.value)}
                      style={{ padding: '8px 28px 8px 16px', fontSize: '0.8rem', fontWeight: 700, borderRadius: '24px', appearance: 'none', cursor: 'pointer' }}
                    >
                      <option value="risk">Risk Score</option>
                      <option value="count">Transaction Count</option>
                    </select>
                    <ChevronDown size={12} style={{ position: 'absolute', right: '12px', pointerEvents: 'none', color: 'var(--text-secondary)' }} />
                  </div>
                </div>

                {/* Map Container */}
                <div style={{ position: 'relative', flexGrow: 1, overflow: 'hidden', background: '#f8fafc', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                    
                    {/* Leaflet Map Div */}
                    <div 
                      id="leaflet-risk-map" 
                      ref={leafletMapRef}
                      style={{ width: '100%', height: '100%', minHeight: '320px', background: '#f8fafc', zIndex: 1 }}
                    ></div>

                    {/* Zoom Controls */}
                    <div style={{
                      position: 'absolute',
                      left: '16px',
                      top: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '1px',
                      background: '#ffffff',
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      boxShadow: '0 4px 10px rgba(15, 23, 42, 0.05)',
                      zIndex: 10
                    }}>
                      <button 
                        onClick={() => { if (leafletInstance.current) leafletInstance.current.zoomIn(); }}
                        style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem', color: 'var(--text-secondary)' }}
                      >
                        +
                      </button>
                      <div style={{ height: '1px', backgroundColor: 'var(--border-color)' }}></div>
                      <button 
                        onClick={() => { if (leafletInstance.current) leafletInstance.current.zoomOut(); }}
                        style={{ width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '1rem', color: 'var(--text-secondary)' }}
                      >
                        -
                      </button>
                    </div>

                    {/* Legend */}
                    <div style={{
                      position: 'absolute',
                      left: '16px',
                      bottom: '16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: 'var(--text-secondary)',
                      zIndex: 10
                    }}>
                      <span>{heatmapMetric === 'risk' ? 'Low Risk' : 'Low Volume'}</span>
                      <div style={{
                        width: '120px',
                        height: '8px',
                        borderRadius: '4px',
                        background: heatmapMetric === 'risk' 
                          ? 'linear-gradient(to right, rgba(239, 68, 68, 0.04), rgb(239, 68, 68))'
                          : 'linear-gradient(to right, rgba(59, 130, 246, 0.04), rgb(59, 130, 246))',
                        border: '1px solid var(--border-color)'
                      }}></div>
                      <span>{heatmapMetric === 'risk' ? 'High Risk' : 'High Volume'}</span>
                    </div>
                  </div>
                </div>
                  {/* Risk by Top Companies line graph */}
                <div className="glass-panel panel-container" style={{ display: 'flex', flexDirection: 'column', height: '420px', padding: '24px' }}>
                  <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: 'rgba(99, 102, 241, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)' }}>
                        <Building2 size={20} />
                      </div>
                      <div>
                        <h2 className="panel-title">Risk by Top Companies</h2>
                        <p className="panel-subtitle">Average risk score by top 10 companies</p>
                      </div>
                    </div>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <select 
                        className="date-picker-btn" 
                        value={companiesTimeRange} 
                        onChange={(e) => setCompaniesTimeRange(e.target.value)}
                        style={{ padding: '8px 28px 8px 16px', fontSize: '0.8rem', fontWeight: 700, borderRadius: '24px', appearance: 'none', cursor: 'pointer' }}
                      >
                        <option value="12m">Last 12 Months</option>
                        <option value="6m">Last 6 Months</option>
                        <option value="30d">Last 30 Days</option>
                      </select>
                      <ChevronDown size={12} style={{ position: 'absolute', right: '12px', pointerEvents: 'none', color: 'var(--text-secondary)' }} />
                    </div>
                  </div>

                  {/* List Container */}
                <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, overflow: 'hidden' }}>
                  {(() => {
                    const companies = [
                      { name: 'Alpha Fintech Ltd.', icon: <Zap size={12} />, score: 0.92 },
                      { name: 'GlobalPay Systems', icon: <CreditCard size={12} />, score: 0.81 },
                      { name: 'TransactNet Inc.', icon: <Send size={12} />, score: 0.74 },
                      { name: 'SecureWave Corp.', icon: <ShieldCheck size={12} />, score: 0.66 },
                      { name: 'PrimeTx Holdings', icon: <TrendingUp size={12} />, score: 0.58 },
                      { name: 'Vertex Payments', icon: <CheckCircle2 size={12} />, score: 0.51 },
                      { name: 'Nexus Financials', icon: <Target size={12} />, score: 0.45 },
                      { name: 'Bluechip Solutions', icon: <Cpu size={12} />, score: 0.38 },
                      { name: 'Moneta Services', icon: <Database size={12} />, score: 0.33 },
                      { name: 'Credex Technologies', icon: <Gauge size={12} />, score: 0.28 }
                    ];

                    const multiplier = companiesTimeRange === '30d' ? 0.65 : companiesTimeRange === '6m' ? 0.82 : 1.0;
                    const simulatedCompanies = companies.map((c, idx) => {
                      const wave = Math.sin(simulationTick * 0.4 + idx) * 0.015;
                      const score = Math.max(0.1, Math.min(0.99, (c.score * multiplier) + wave));
                      return { ...c, score };
                    });

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
                        {/* Rows Wrapper */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                          {simulatedCompanies.map((company) => {
                            const widthPercent = company.score * 88;
                            return (
                              <div key={company.name} style={{ display: 'flex', alignItems: 'center', gap: '16px', height: '20px' }}>
                                
                                {/* Logo & Name Column */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '180px', flexShrink: 0 }}>
                                  <div style={{ 
                                    width: '22px', 
                                    height: '22px', 
                                    borderRadius: '6px', 
                                    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(99, 102, 241, 0.15))', 
                                    border: '1px solid rgba(99, 102, 241, 0.2)', 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center', 
                                    color: '#3b82f6', 
                                    flexShrink: 0 
                                  }}>
                                    {company.icon}
                                  </div>
                                  <span style={{ 
                                    fontSize: '0.75rem', 
                                    fontWeight: 600, 
                                    color: 'var(--text-secondary)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                  }}>
                                    {company.name}
                                  </span>
                                </div>

                                {/* Progress bar container */}
                                <div style={{ flexGrow: 1, position: 'relative', height: '20px', display: 'flex', alignItems: 'center' }}>
                                  {/* Track */}
                                  <div style={{ position: 'absolute', left: 0, right: 0, height: '6px', background: '#f8fafc', borderRadius: '3px', border: '1px solid #f1f5f9' }}></div>
                                  
                                  {/* Fill */}
                                  <div style={{ 
                                    position: 'absolute', 
                                    left: 0, 
                                    width: `${widthPercent}%`, 
                                    height: '6px', 
                                    background: 'linear-gradient(90deg, #a78bfa, #7c3aed)', 
                                    borderRadius: '3px',
                                    boxShadow: '0 1px 3px rgba(124, 58, 237, 0.15)',
                                    transition: 'all 1.5s ease-in-out'
                                  }}></div>

                                  {/* Label at the end of the bar */}
                                  <div style={{ 
                                    position: 'absolute', 
                                    left: `calc(${widthPercent}% + 10px)`, 
                                    fontSize: '0.72rem', 
                                    fontWeight: 700, 
                                    color: 'var(--text-secondary)',
                                    transition: 'all 1.5s ease-in-out'
                                  }}>
                                    {company.score.toFixed(2)}
                                  </div>
                                </div>

                              </div>
                            );
                          })}
                        </div>

                        {/* Bottom Axis Area */}
                        <div style={{ marginTop: '8px' }}>
                          {/* Bottom Axis Ticks */}
                          <div style={{ position: 'relative', width: 'calc(100% - 196px)', height: '22px', marginLeft: '196px', borderTop: '1px solid var(--border-color)' }}>
                            {[
                              { label: '0.00', pct: 0 },
                              { label: '0.25', pct: 22 },
                              { label: '0.50', pct: 44 },
                              { label: '0.75', pct: 66 },
                              { label: '1.00', pct: 88 }
                            ].map(tick => (
                              <div key={tick.label} style={{ position: 'absolute', left: `${tick.pct}%`, transform: 'translateX(-50%)', top: '4px' }}>
                                <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)' }}>{tick.label}</span>
                              </div>
                            ))}
                          </div>

                          {/* Axis Title */}
                          <div style={{ textAlign: 'center', width: 'calc(100% - 196px)', marginLeft: '196px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: '8px' }}>
                            Average Risk Score
                          </div>
                        </div>

                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Critical Ledger Table */}
            <div className="glass-panel panel-container">
              <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444' }}>
                    <ShieldAlert size={20} />
                  </div>
                  <div>
                    <h2 className="panel-title">Critical Events Ledger (Top 10 Highest Risk Events)</h2>
                    <p className="panel-subtitle">List of transaction triggers classified by predictive analysis scoring.</p>
                  </div>
                </div>
                <button 
                  className="date-picker-btn" 
                  onClick={() => setShowAllEvents(prev => !prev)}
                  style={{ borderColor: '#7c3aed', color: '#7c3aed', borderRadius: '24px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 700, padding: '8px 16px', cursor: 'pointer', transition: 'all 0.2s ease' }}
                >
                  <span>{showAllEvents ? 'Show Top 10' : 'View All Events'}</span>
                  <ArrowRight size={14} style={{ transform: showAllEvents ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s ease' }} />
                </button>
              </div>
              <div className="ledger-container">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th style={{ width: '60px' }}>RANK</th>
                      <th>EVENT ID</th>
                      <th>EVENT TYPE</th>
                      <th>CHANNEL</th>
                      <th>COUNTRY</th>
                      <th style={{ textAlign: 'center' }}>RISK SCORE</th>
                      <th>AMOUNT (USD)</th>
                      <th>TIME</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const countryCodes = {
                        'Nigeria': 'ng',
                        'Iran': 'ir',
                        'Myanmar': 'mm',
                        'Russia': 'ru',
                        'China': 'cn',
                        'United Arab Emirates': 'ae',
                        'Germany': 'de',
                        'United Kingdom': 'gb',
                        'Singapore': 'sg',
                        'United States': 'us'
                      };

                      const getChannelDetails = (type) => {
                        const lower = (type || '').toLowerCase();
                        if (lower.includes('structuring') || lower.includes('laundering') || lower.includes('smurfing') || lower.includes('wire')) {
                          return { name: 'Wire Transfer', icon: <Send size={14} style={{ color: '#8b5cf6' }} /> };
                        } else if (lower.includes('takeover') || lower.includes('card') || lower.includes('purchase')) {
                          return { name: 'Card Purchase', icon: <CreditCard size={14} style={{ color: '#3b82f6' }} /> };
                        } else if (lower.includes('layering') || lower.includes('investment') || lower.includes('shell')) {
                          return { name: 'Shell Transfer', icon: <Layers size={14} style={{ color: '#0d9488' }} /> };
                        }
                        return { name: 'Transfer', icon: <Send size={14} style={{ color: '#8b5cf6' }} /> };
                      };

                      const formatLedgerTime = (isoStr) => {
                        try {
                          const date = new Date(isoStr);
                          const month = date.toLocaleDateString('en-US', { month: 'short' });
                          const day = String(date.getDate()).padStart(2, '0');
                          const year = date.getFullYear();
                          let hours = date.getHours();
                          const minutes = String(date.getMinutes()).padStart(2, '0');
                          const ampm = hours >= 12 ? 'PM' : 'AM';
                          hours = hours % 12;
                          hours = hours ? hours : 12;
                          const strHours = String(hours).padStart(2, '0');
                          return `${month} ${day}, ${year} ${strHours}:${minutes} ${ampm}`;
                        } catch (e) {
                          return isoStr;
                        }
                      };

                      const fallbackEvents = [
                        { transaction_id: 'EVT-98231', timestamp: '2025-06-05T10:42:00', amount: 245000, transaction_type: 'Structuring', country: 'Nigeria', risk_score: 0.98 },
                        { transaction_id: 'EVT-87214', timestamp: '2025-06-05T09:15:00', amount: 120500, transaction_type: 'Account Takeover', country: 'Iran', risk_score: 0.95 },
                        { transaction_id: 'EVT-77108', timestamp: '2025-06-04T16:33:00', amount: 310000, transaction_type: 'Money Laundering', country: 'Myanmar', risk_score: 0.93 },
                        { transaction_id: 'EVT-65492', timestamp: '2025-06-04T11:22:00', amount: 195000, transaction_type: 'Asset Layering', country: 'Russia', risk_score: 0.89 },
                        { transaction_id: 'EVT-54210', timestamp: '2025-06-03T15:10:00', amount: 85000, transaction_type: 'Smurfing', country: 'China', risk_score: 0.86 },
                        { transaction_id: 'EVT-43921', timestamp: '2025-06-03T08:45:00', amount: 412000, transaction_type: 'Money Laundering', country: 'United Arab Emirates', risk_score: 0.84 },
                        { transaction_id: 'EVT-39045', timestamp: '2025-06-02T18:20:00', amount: 63000, transaction_type: 'Structuring', country: 'Germany', risk_score: 0.81 },
                        { transaction_id: 'EVT-28490', timestamp: '2025-06-02T13:14:00', amount: 145000, transaction_type: 'Asset Layering', country: 'United Kingdom', risk_score: 0.78 },
                        { transaction_id: 'EVT-19024', timestamp: '2025-06-01T10:05:00', amount: 28000, transaction_type: 'Smurfing', country: 'Singapore', risk_score: 0.75 },
                        { transaction_id: 'EVT-10294', timestamp: '2025-06-01T09:12:00', amount: 92000, transaction_type: 'Account Takeover', country: 'United States', risk_score: 0.72 },
                        { transaction_id: 'EVT-09182', timestamp: '2025-05-31T22:30:00', amount: 187000, transaction_type: 'Structuring', country: 'Russia', risk_score: 0.69 },
                        { transaction_id: 'EVT-08401', timestamp: '2025-05-31T14:48:00', amount: 56000, transaction_type: 'Money Laundering', country: 'Nigeria', risk_score: 0.67 },
                        { transaction_id: 'EVT-07294', timestamp: '2025-05-30T19:05:00', amount: 230000, transaction_type: 'Asset Layering', country: 'China', risk_score: 0.65 },
                        { transaction_id: 'EVT-06510', timestamp: '2025-05-30T11:33:00', amount: 74000, transaction_type: 'Account Takeover', country: 'Iran', risk_score: 0.63 },
                        { transaction_id: 'EVT-05832', timestamp: '2025-05-29T16:21:00', amount: 160000, transaction_type: 'Smurfing', country: 'Myanmar', risk_score: 0.61 },
                        { transaction_id: 'EVT-04710', timestamp: '2025-05-29T09:44:00', amount: 42000, transaction_type: 'Structuring', country: 'United Arab Emirates', risk_score: 0.58 },
                        { transaction_id: 'EVT-03921', timestamp: '2025-05-28T20:15:00', amount: 295000, transaction_type: 'Money Laundering', country: 'Germany', risk_score: 0.55 },
                        { transaction_id: 'EVT-02840', timestamp: '2025-05-28T08:30:00', amount: 110000, transaction_type: 'Asset Layering', country: 'Singapore', risk_score: 0.53 },
                        { transaction_id: 'EVT-01592', timestamp: '2025-05-27T15:10:00', amount: 67000, transaction_type: 'Account Takeover', country: 'United Kingdom', risk_score: 0.51 },
                        { transaction_id: 'EVT-00481', timestamp: '2025-05-27T07:55:00', amount: 38000, transaction_type: 'Smurfing', country: 'United States', risk_score: 0.48 }
                      ];

                      const displayEvents = criticalEvents.length > 0 ? criticalEvents : fallbackEvents;
                      const eventsToShow = showAllEvents ? displayEvents : displayEvents.slice(0, 10);
                      return eventsToShow.map((evt, idx) => {
                        const channel = getChannelDetails(evt.transaction_type);
                        return (
                          <tr key={evt.transaction_id}>
                            <td>
                              <span style={{ 
                                display: 'inline-flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                width: '24px', 
                                height: '24px', 
                                borderRadius: '50%', 
                                border: '1px solid rgba(239, 68, 68, 0.15)', 
                                background: 'rgba(239, 68, 68, 0.03)', 
                                color: '#ef4444', 
                                fontWeight: 700, 
                                fontSize: '0.75rem' 
                              }}>
                                {idx + 1}
                              </span>
                            </td>
                            <td style={{ fontFamily: 'var(--font-sans)', fontWeight: 700, color: 'var(--text-secondary)' }}>{evt.transaction_id}</td>
                            <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{evt.transaction_type}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                {channel.icon}
                                <span>{channel.name}</span>
                              </div>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <img src={`https://flagcdn.com/w20/${countryCodes[evt.country] || 'us'}.png`} width="20" alt={evt.country} style={{ borderRadius: '2px' }} />
                                <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{evt.country}</span>
                              </div>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span style={{ 
                                padding: '4px 10px', 
                                borderRadius: '12px', 
                                background: 'rgba(239, 68, 68, 0.06)', 
                                color: '#ef4444', 
                                fontWeight: 700, 
                                fontSize: '0.8rem',
                                border: '1px solid rgba(239, 68, 68, 0.1)'
                              }}>
                                {evt.risk_score.toFixed(2)}
                              </span>
                            </td>
                            <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                              {evt.amount.toLocaleString(undefined, {style: 'currency', currency: 'USD', maximumFractionDigits: 0})}
                            </td>
                            <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 500 }}>
                              {formatLedgerTime(evt.timestamp)}
                            </td>
                            <td>
                              <span style={{ 
                                padding: '4px 12px', 
                                borderRadius: '12px', 
                                background: 'rgba(239, 68, 68, 0.05)', 
                                color: '#ef4444', 
                                fontWeight: 700, 
                                fontSize: '0.75rem', 
                                border: '1px solid rgba(239, 68, 68, 0.08)',
                                whiteSpace: 'nowrap',
                                display: 'inline-block'
                              }}>
                                High Risk
                              </span>
                            </td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* GRAPH NETWORK TAB */}
        {activeTab === 'graph' && (
          <div className="fade-in graph-container">
            <div className="graph-controls">
              <div className="slider-group">
                <label>
                  <span>Filter Minimum Edge Risk</span>
                  <span style={{ color: 'var(--color-primary)', fontWeight: 700 }}>{minRisk}</span>
                </label>
                <input 
                  type="range" 
                  min="0.0" 
                  max="0.9" 
                  step="0.05" 
                  value={minRisk} 
                  onChange={e => setMinRisk(parseFloat(e.target.value))}
                />
              </div>
              <div className="slider-group">
                <label>
                  <span>Max Displayed Nodes/Edges</span>
                  <span style={{ color: 'var(--color-secondary)', fontWeight: 700 }}>{maxEdges}</span>
                </label>
                <input 
                  type="range" 
                  min="50" 
                  max="400" 
                  step="25" 
                  value={maxEdges} 
                  onChange={e => setMaxEdges(parseInt(e.target.value))}
                />
              </div>
            </div>

            <div className="network-canvas-container">
              {graphLoading && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255, 255, 255, 0.7)', zIndex: 10 }}>
                  <Loader2 className="spinner" size={40} style={{ color: 'var(--color-primary)' }} />
                </div>
              )}
              <div ref={networkRef} style={{ width: '100%', height: '100%' }} />
            </div>

            {/* Modularity communities ledger */}
            <div className="glass-panel panel-container">
              <div className="panel-header" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <NetIcon size={20} style={{ color: 'var(--color-primary)' }} />
                <div>
                  <h2 className="panel-title">Louvain Ring Risk Assessment Ledger</h2>
                  <p className="panel-subtitle">Modularity partitions sorted by aggregate vulnerability risk ratings.</p>
                </div>
              </div>
              <div className="ledger-container">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Community Ring</th>
                      <th>Total Nodes</th>
                      <th>Customers</th>
                      <th>Bank Accounts</th>
                      <th>Aggregate Volume</th>
                      <th>Vulnerability Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {graphData.communities.map(comm => (
                      <tr key={comm.community_ring}>
                        <td style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{comm.community_ring}</td>
                        <td>{comm.total_nodes}</td>
                        <td>{comm.customer_entities}</td>
                        <td>{comm.associated_bank_accounts}</td>
                        <td style={{ fontWeight: 700 }}>${comm.aggregate_volume.toLocaleString(undefined, {maximumFractionDigits: 2})}</td>
                        <td>
                          <span className="risk-pill critical">
                            {comm.vulnerability_risk_rating.toFixed(4)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* COMPLIANCE COPILOT TAB */}
        {activeTab === 'copilot' && (
          <div className="glass-panel panel-container copilot-chat fade-in">
            {/* Proper Chat Interface Header */}
            <div className="chat-header">
              <div className="chat-avatar">
                <Sparkles size={22} />
                <div className="chat-status-dot"></div>
              </div>
              <div className="chat-header-info">
                <span className="chat-header-title">Elysium Compliance Assistant</span>
                <span className="chat-header-status">
                  <div className="system-profile-dot" style={{ width: 8, height: 8 }}></div>
                  Online • Gemini Routing Engine
                </span>
              </div>
            </div>

            <div className="copilot-messages custom-scroll">
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', margin: 'auto', maxWidth: '400px', color: 'var(--text-muted)' }}>
                  <MessageSquare size={36} style={{ marginBottom: '12px', color: 'var(--color-primary)' }} />
                  <p style={{ fontWeight: 500, fontSize: '0.95rem' }}>Ask a compliance question or click one of the suggested prompts below to analyze risk factors.</p>
                </div>
              )}
              {messages.map((msg, idx) => (
                <div key={idx} className={`chat-bubble-wrapper ${msg.role}`}>
                  <span className="chat-sender-name">{msg.role === 'user' ? 'You' : 'Elysium AI'}</span>
                  <div className={`chat-bubble ${msg.role}`}>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                    {msg.model && (
                      <div className={`model-badge ${msg.model.includes('Flash') || msg.model.includes('Simulated') ? 'flash' : 'pro'}`}>
                        {msg.model.includes('Flash') ? '⚡' : msg.model.includes('Pro') ? '🧠' : 'ℹ️'} {msg.model}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {copilotLoading && (
                <div className="chat-bubble-wrapper assistant">
                  <span className="chat-sender-name">Elysium AI</span>
                  <div className="chat-bubble assistant" style={{ padding: '12px 20px' }}>
                    <Loader2 className="spinner" size={20} />
                  </div>
                </div>
              )}
            </div>

            {/* Suggestions */}
            <div className="copilot-suggestions">
              {suggestedQueries.map((q, idx) => (
                <button 
                  key={idx} 
                  className="suggestion-pill"
                  onClick={() => handleSendCopilot(q)}
                  disabled={copilotLoading}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Input form */}
            <form 
              className="copilot-input-form"
              onSubmit={e => {
                e.preventDefault();
                handleSendCopilot();
              }}
            >
              <input 
                type="text" 
                className="copilot-input"
                placeholder="Ask about compliance procedures, wire limits, pattern review alerts..."
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                disabled={copilotLoading}
              />
              <button 
                type="submit" 
                className="copilot-submit-btn"
                disabled={copilotLoading || !inputText.trim()}
              >
                <Send size={18} />
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

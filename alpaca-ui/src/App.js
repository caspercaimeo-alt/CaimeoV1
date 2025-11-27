import React, { useEffect, useState, useRef } from "react";

const SERVER = process.env.REACT_APP_SERVER_URL;
;
function App() {
  const [logs, setLogs] = useState("");
  const [status, setStatus] = useState("Stopped");
  const [discovered, setDiscovered] = useState([]);
  const [cardsToShow, setCardsToShow] = useState(16);
  const [portfolio, setPortfolio] = useState([]);
  const [orders, setOrders] = useState([]);
  const [trades, setTrades] = useState([]);
  const [account, setAccount] = useState({ cash: null, invested: null, buying_power: null, equity: null });
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [msg, setMsg] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [meta, setMeta] = useState({
    total_scanned: 10000,
    after_filters: 0,
    displayed: 0,
  });
  const [progress, setProgress] = useState({
    percent: 0,
    eta: "N/A",
    status: "Idle",
  });
  const [navOpen, setNavOpen] = useState(false);
  const logsBoxRef = useRef(null);

  async function fetchProgress() {
    try {
      const res = await fetch(`${SERVER}/progress`);
      const data = await res.json();
      setProgress({
        percent: data.percent || 0,
        eta: data.eta || "N/A",
        status: data.status || "Idle",
      });
    } catch {
      setProgress({ percent: 0, eta: "N/A", status: "Idle" });
    }
  }

  // Adapt number of discovery cards to viewport (4 full rows)
  const computeCardsToShow = (width) => {
    const columns = Math.min(6, Math.max(1, Math.floor((width - 60) / 220)));
    return columns * 4;
  };

  // ---- Fetch Discovered Stocks ----
  async function fetchDiscovered() {
  try {
    const res = await fetch(`${SERVER}/discovered`);
    const data = await res.json();

    // 🧩 Diagnostic log to confirm backend data
    console.log("🔍 /discovered response:", data);

    // ✅ Filter out F-rated or below-C stocks
    const list = Array.isArray(data.symbols)
      ? data.symbols.filter(
          (s) =>
            !s.confidence ||
            s.confidence === "A" ||
            s.confidence === "B" ||
            s.confidence === "C"
        )
      : [];

          // Sort descending by confidence letter (A highest → F lowest)
            const sorted = list.sort((a, b) => {
          const order = { A: 3, B: 2, C: 1, D: 0, F: -1 };
          return (order[b.confidence] || 0) - (order[a.confidence] || 0);
          });

setDiscovered(sorted);


    setMeta({
      total_scanned: 10000,
      after_filters: list.length,
      displayed: Math.min(computeCardsToShow(window.innerWidth), sorted.length),
    });
  } catch (err) {
    console.error("Failed to fetch discovered stocks:", err);
  }


  }

  // ---- Submit API Keys ----
  async function submitKeys(e) {
    e.preventDefault();
    setMsg("Validating...");
    try {
      const res = await fetch(`${SERVER}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret }),
      });
      const data = await res.json();
      if (data.valid) {
        setAuthenticated(true);
        setMsg("✅ Keys validated successfully");
        fetchPortfolio();
        fetchAccount();
      } else {
        setAuthenticated(false);
        setMsg("❌ Invalid API credentials");
      }
    } catch {
      setMsg("❌ Server error");
      setAuthenticated(false);
    }
  }

  // ---- Start / Stop Bot ----
  async function handleControl(action) {
    if (action === "start" && !authenticated) {
      alert("Please authenticate your API keys before starting the bot.");
      return;
    }

    try {
      const res = await fetch(`${SERVER}/${action}`, { method: "POST" });
      const data = await res.json();
      if (data.status === "started") setStatus("Running");
      else if (data.status === "stopped") setStatus("Stopped");
      else if (data.status === "already running") setStatus("Running");
      else if (data.status === "error") {
        alert(data.message || "Error starting bot. Check credentials.");
        setStatus("Stopped");
      }
    } catch (err) {
      console.error("Control error:", err);
      setStatus("Error");
    }
  }

  // ---- Fetch Bot Status ----
  async function fetchStatus() {
    try {
      const res = await fetch(`${SERVER}/status`);
      const data = await res.json();
      if (data.status) setStatus(data.status);
    } catch {
      setStatus("Unknown");
    }
  }

  // ---- Fetch Account ----
  async function fetchAccount() {
    try {
      const res = await fetch(`${SERVER}/account`);
      const data = await res.json();
      if (data && data.cash !== undefined) setAccount(data);
      else setAccount({ cash: null, invested: null, buying_power: null, equity: null });
    } catch {
      setAccount({ cash: null, invested: null, buying_power: null, equity: null });
    }
  }

  // ---- Fetch Portfolio ----
  async function fetchPortfolio() {
    try {
      const res = await fetch(`${SERVER}/positions`);
      const data = await res.json();
      if (Array.isArray(data.positions)) setPortfolio(data.positions);
      else setPortfolio([]);
    } catch {
      setPortfolio([]);
    }
  }

  // ---- Fetch Open Orders ----
  async function fetchOrders() {
    try {
      const res = await fetch(`${SERVER}/orders`);
      const data = await res.json();
      if (Array.isArray(data.orders)) setOrders(data.orders);
      else setOrders([]);
    } catch {
      setOrders([]);
    }
  }

  // ---- Fetch Trade History ----
  async function fetchTrades() {
    try {
      const res = await fetch(`${SERVER}/trade_history`);
      const data = await res.json();
      if (Array.isArray(data.trades)) setTrades(data.trades);
      else setTrades([]);
    } catch {
      setTrades([]);
    }
  }

  // ---- Fetch Logs ----
  useEffect(() => {
    async function fetchLogs() {
      try {
        const res = await fetch(`${SERVER}/logs`);
        const json = await res.json();
        if (json.logs) setLogs(json.logs.join("\n"));
        else setLogs("No recent activity.");
      } catch (err) {
        console.error("Failed to fetch logs:", err);
        setLogs("⚠️ Could not load log file.");
      }
    }

    fetchLogs();
    const interval = setInterval(fetchLogs, 8000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll live feed to bottom when logs update
  useEffect(() => {
    if (logsBoxRef.current) {
      logsBoxRef.current.scrollTop = logsBoxRef.current.scrollHeight;
    }
  }, [logs]);

  // ---- Initial Data ----
  useEffect(() => {
    fetchDiscovered();
    fetchPortfolio();
    fetchStatus();
    fetchProgress(); // start polling discovery progress
    const updateCards = () => setCardsToShow(computeCardsToShow(window.innerWidth));
    updateCards();
    window.addEventListener("resize", updateCards);

    const statusInterval = setInterval(() => {
      fetchStatus();
      fetchProgress();
    }, 5000);

    return () => {
      clearInterval(statusInterval);
      window.removeEventListener("resize", updateCards);
    };
  }, []);

  useEffect(() => {
    setMeta((prev) => ({
      ...prev,
      displayed: Math.min(cardsToShow, prev.after_filters || 0),
    }));
  }, [cardsToShow]);

  // Poll portfolio when authenticated
  useEffect(() => {
    if (!authenticated) return;
    fetchPortfolio();
    fetchOrders();
    fetchTrades();
    fetchAccount();
    const id = setInterval(fetchPortfolio, 10000);
    const id2 = setInterval(fetchOrders, 12000);
    const id4 = setInterval(fetchTrades, 25000);
    const id3 = setInterval(fetchAccount, 20000);
    return () => {
      clearInterval(id);
      clearInterval(id2);
      clearInterval(id3);
      clearInterval(id4);
    };
  }, [authenticated]);


  const calcGainLoss = (p) => ((p.currentPrice - p.avgPrice) * p.qty).toFixed(2);
  const calcTradePnl = (t) => {
    if (
      t.soldPrice === null ||
      t.soldPrice === undefined ||
      t.avgPrice === null ||
      t.avgPrice === undefined ||
      t.qty === null ||
      t.qty === undefined
    ) {
      return null;
    }
    const sold = Number(t.soldPrice);
    const avg = Number(t.avgPrice);
    const qty = Number(t.qty);
    if ([sold, avg, qty].some((v) => Number.isNaN(v))) return null;
    return ((sold - avg) * qty).toFixed(2);
  };
  const fmt1 = (v, suffix = "") => {
    if (v === null || v === undefined || Number.isNaN(Number(v)))
      return "N/A" + suffix;
    return Number(v).toFixed(1) + suffix;
  };
  const fmtMoney = (v) =>
    v === null || v === undefined || Number.isNaN(Number(v))
      ? "N/A"
      : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const numOr = (v, fallback) =>
    v === null || v === undefined || Number.isNaN(Number(v))
      ? fallback
      : Number(v);

  const navItems = [
    { label: "API Auth", href: "#auth-section" },
    { label: "Bot Status", href: "#status-section" },
    { label: "Live Feed", href: "#live-feed-section" },
    { label: "Discovery", href: "#discovery-section" },
    { label: "Portfolio", href: "#portfolio-section" },
  ];

  // ---- Confidence Grade Mapping ----
  const getConfidenceGrade = (conf) => {
    if (conf >= 0.9) return { grade: "A", color: "#3cb043" };
    if (conf >= 0.8) return { grade: "B", color: "#7dc242" };
    if (conf >= 0.7) return { grade: "C", color: "#f0c93d" };
    if (conf >= 0.6) return { grade: "D", color: "#f28f3b" };
    return { grade: "F", color: "#d94f4f" };
  };

  /* -------------------- STYLES -------------------- */
  const styles = {
    page: {
      backgroundColor: "#483c3bd5",
      backgroundImage: "url('/circuit_bg4.png')",
      backgroundRepeat: "repeat",
      backgroundSize: "contain",
      color: "white",
      fontFamily: "Arial, sans-serif",
      minHeight: "100vh",
      overflowX: "hidden",
      overflowY: "auto",
      paddingTop: "0px",
      margin: 0,
      paddingBottom: "100px",
    },
    headerBox: {
      backgroundColor: "#462323",
      border: "0",
      borderBottom: "5px solid #FCFBF4",
      borderRadius: "0px",
      width: "100%",
      height: "50px",
      margin: "0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "2px 10px",
      position: "relative",
      boxShadow: "0 6px 12px rgba(0,0,0,0.25)",
      gap: "2px",
    },
    title: {
      fontSize: "32px",
      fontWeight: "900",
      letterSpacing: "1px",
      color: "#FCFBF4",
      textAlign: "center",
      margin: 0,
    },
    navLinksInline: {
      display: "none",
      flexDirection: "column",
      alignItems: "stretch",
      gap: "0",
      position: "absolute",
      left: "50%",
      transform: "translateX(-50%)",
      top: "100%",
      width: "160px",
      backgroundColor: "#FCFBF4",
      border: "2px solid #462323",
      borderRadius: "0 0 10px 10px",
      overflow: "hidden",
      boxShadow: "0 8px 16px rgba(0,0,0,0.25)",
      pointerEvents: "auto",
    },
    navLinkInline: {
      color: "#462323",
      textDecoration: "none",
      fontSize: "12px",
      fontWeight: "700",
      padding: "8px 10px",
      borderBottom: "1px solid #462323",
      backgroundColor: "#FCFBF4",
    },
    navBar: {
      position: "static",
      width: "100%",
      zIndex: 10,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "transparent",
      padding: "0",
      border: "0",
      borderBottom: "0",
      boxShadow: "none",
      margin: "0",
    },
    navMenuWrapper: {
      display: "none",
    },
    authWrapper: {
      backgroundColor: "transparent",
      border: "none",
      borderRadius: "0px",
      width: "55%",
      margin: "0 auto 40px",
      padding: "20px 0 40px 0",
    },
    authHeader: {
      backgroundColor: "#462323",
      color: "#FCFBF4",
      border: "5px solid #FCFBF4",
      borderRadius: "10px",
      width: "100%",
      margin: "15px auto",
      textAlign: "center",
      padding: "10px 0",
      fontWeight: "bold",
      fontSize: "26px",
    },
    authBox: {
      backgroundColor: "#FCFBF4",
      border: "4px solid #462323",
      width: "45%",
      margin: "30px auto",
      textAlign: "center",
      padding: "0",
      borderRadius: "8px",
      color: "black",
    },
    authContent: {
      padding: "32px 24px 24px",
    },
    authInput: {
      width: "80%",
      padding: "12px",
      margin: "8px 0",
      border: "2px solid #462323",
      borderRadius: "6px",
      fontSize: "16px",
    },
    authButton: {
      padding: "10px 22px",
      marginTop: "10px",
      marginRight: "32px",
      border: "3px solid #462323",
      borderRadius: "8px",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      fontWeight: "700",
      fontSize: "16px",
      cursor: "pointer",
    },
    statusBox: {
      backgroundColor: "#FCFBF4",
      border: "4px solid #462323",
      borderRadius: "12px",
      padding: "0px 18px 10px",
      width: "32%",
      margin: "0 auto 30px",
      textAlign: "center",
      color: "#462323",
      boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
      minHeight: "220px",
    },
    sectionHeaderDiv: {
      backgroundColor: "#462323",
      border: "5px solid #FCFBF4",
      borderRadius: "10px",
      width: "75%",
      margin: "0 auto 20px",
      textAlign: "center",
      padding: "10px 0",
      color: "#FCFBF4",
      fontWeight: "bold",
      fontSize: "26px",
    },
    table: {
      width: "100%",
      margin: "0 auto",
      borderCollapse: "collapse",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      border: "4px solid "#462323",
      borderRadius: "10px",
    },
    th: {
      border: "2px solid #462323",
      padding: "8px",
      backgroundColor: "#462323",
      color: "#FCFBF4",
      fontSize: "14px",
    },
    td: {
      border: "2px solid #462323",
      padding: "6px",
      fontSize: "12px",
    },
    gainLoss: {
      border: "2px solid #462323",
      width: "100px",
      textAlign: "center",
    },
    discoveryWrapper: {
      backgroundColor: "transparent",
      border: "none",
      borderRadius: "0px",
      width: "70%",
      margin: "0 auto 40px",
      padding: "60px 0 30px",
    },
    portfolioWrapper: {
      backgroundColor: "transparent",
      border: "0",
      borderRadius: "0px",
      width: "90%",
      margin: "0 auto 40px",
      padding: "60px 0 30px",
    },
    discoveryGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(3, minmax(160px, 1fr))",
      justifyItems: "center",
      gap: "1.5rem",
      width: "80%",
      margin: "0 auto",
    },
    stockCard: {
      border: "4px solid #462323",
      borderRadius: "8px",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      width: "170px",
      textAlign: "center",
      textDecoration: "none",
      padding: "12px 10px",
      margin: "10px",
    },
    stockTickerBox: {
      backgroundColor: "#462323",
      color: "#FCFBF4",
      borderRadius: "6px",
      padding: "5px 0",
      marginBottom: "8px",
      fontWeight: "bold",
      fontSize: "22px",
    },
    stockPrice: {
      fontSize: "18px",
      fontWeight: "bold",
      marginBottom: "10px",
    },
    metricTable: {
      width: "100%",
      borderCollapse: "collapse",
      marginTop: "8px",
    },
    metricName: {
      textAlign: "left",
      fontWeight: "600",
      color: "#462323",
      padding: "4px",
      borderBottom: "1px solid #462323",
    },
    metricValue: {
      textAlign: "right",
      padding: "4px",
      borderBottom: "1px solid #462323",
    },
    confidenceBadge: (color) => ({
      display: "inline-block",
      marginTop: "12px",
      padding: "4px 8px",
      borderRadius: "8px",
      fontSize: "13px",
      fontWeight: "bold",
      backgroundColor: color,
      color: "#FCFBF4",
      border: "1px solid #462323",
    }),
    strategyTag: (_color) => ({
      display: "block",
      marginTop: "10px",
      padding: "3px 6px",
      borderRadius: "6px",
      fontSize: "13px",
      fontWeight: "800",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      border: "1px solid #FCFBF4",
    }),
    liveFeedBox: {
      backgroundColor: "#FCFBF4",
      border: "4px solid #462323",
      borderRadius: "0 0 10px 10px",
      borderTop: "0",
      width: "100%",
      margin: "0 auto",
      color: "#462323",
      padding: "16px 18px",
      maxHeight: "250px",
      overflowY: "auto",
      fontFamily: "monospace",
      lineHeight: 1.4,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      boxShadow: "0 6px 18px rgba(0,0,0,0.25)",
    },
    tradeButton: {
      padding: "8px 14px",
      marginTop: "10px",
      border: "2px solid #462323",
      borderRadius: "8px",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      fontWeight: "700",
      fontSize: "13px",
      cursor: "pointer",
      marginRight: "8px",
    },
  };

  // Mobile-friendly overrides layered atop inline desktop styles
  const responsiveCss = `
    @media (max-width: 900px) {
      .status-live-row { flex-direction: column !important; gap: 32px !important; padding: 0 12px !important; }
      .status-card, .live-feed-card { width: 100% !important; margin: 0 !important; }
      .live-feed-box { width: 94% !important; max-height: 320px !important; margin: 0 auto !important; }
      .auth-wrapper, .auth-box { width: 92% !important; }
      .auth-input { width: 100% !important; }
      .discovery-wrapper, .portfolio-wrapper { width: 94% !important; padding: 24px 12px !important; }
      .discovery-grid { width: 100% !important; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)) !important; gap: 1rem !important; }
      .table-wrap { width: 94% !important; overflow-x: auto !important; }
      .table-wrap table { min-width: 520px; }
      .section-header { width: 94% !important; font-size: 24px !important; }
      .nav-links-inline { left: 0 !important; transform: none !important; width: 100% !important; position: static !important; }
    }

    @media (max-width: 540px) {
      .title { font-size: 26px !important; }
      .section-header { font-size: 20px !important; }
      .discovery-grid { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)) !important; }
      .live-feed-box { max-height: 260px !important; }
    }
  `;

  return (
    <div style={styles.page}>
      <style>{responsiveCss}</style>
      {/* Nav */}
      <div style={styles.navBar}>
        <div
          style={{
            ...styles.headerBox,
            margin: "0 auto",
          }}
          onMouseEnter={() => setNavOpen(true)}
          onMouseLeave={() => setNavOpen(false)}
        >
          <h1 style={styles.title} className="title">CAIMEO</h1>
          <div
            className="nav-links-inline"
            style={{
              ...styles.navLinksInline,
              display: navOpen ? "flex" : "none",
            }}
            onMouseEnter={() => setNavOpen(true)}
            onMouseLeave={() => setNavOpen(false)}
          >
            {navItems.map((item) => (
              <a key={item.href} href={item.href} style={styles.navLinkInline}>
                {item.label}
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* Auth Section + Status */}
      <div id="auth-section" style={styles.authWrapper} className="auth-wrapper">
        <div style={styles.authBox} className="auth-box">
          <div
          style={{
            backgroundColor: "#462323",
            color: "#FCFBF4",
            width: "100%",
            margin: "0 auto",
            padding: "12px 18px",
            borderRadius: "8px 8px 0 0",
            fontWeight: "900",
            fontSize: "32px",
            borderBottom: "4px solid #FCFBF4",
              boxSizing: "border-box",
            }}
            className="section-header"
          >
            <h2 style={{ margin: 0, fontSize: "38px", lineHeight: 1.1 }}>API Auth</h2>
          </div>
            <div
              style={{
                backgroundColor: "#FCFBF4",
                borderRadius: "0 0 8px 8px",
              }}
            >
            <div style={{ ...styles.authContent, paddingTop: "24px" }}>
              <form onSubmit={submitKeys}>
                <input
                  style={styles.authInput}
                  className="auth-input"
                  type="text"
                  placeholder="API Key"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
                <br />
                <input
                  style={styles.authInput}
                  className="auth-input"
                  type="password"
                  placeholder="API Secret"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                />
                <br />
                <button style={styles.authButton} type="submit">
                  Submit
                </button>
              </form>
              <p>{msg}</p>
            </div>
          </div>
        </div>

        {/* Status + Live Feed row */}
    <div
      className="status-live-row"
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: "24px",
        padding: "0 16px",
        marginTop: "70px",
        marginBottom: "36px",
        maxWidth: "900px",
        width: "70%",
        marginLeft: "auto",
        marginRight: "auto",
      }}
    >
      <div id="status-section" style={{ ...styles.statusBox, width: "35%", margin: "0 auto" }} className="status-card">
        <div
        style={{
          backgroundColor: "#462323",
          color: "#FCFBF4",
          width: "100%",
          margin: "0 auto",
          padding: "10px 10px",
          borderRadius: "10px 10px 0 0",
          fontWeight: "900",
          marginBottom: "24px",
          borderBottom: "4px solid #FCFBF4",
        }}
      >
              <h3 style={{ margin: 0, fontSize: "38px" }}>Bot Status</h3>
            </div>
            <div
              style={{
                display: "inline-block",
                padding: "10px 20px",
                borderRadius: "999px",
                backgroundColor: status === "Running" ? "#2ecc71" : "#e74c3c",
                color: "#FCFBF4",
                fontWeight: "900",
                fontSize: "18px",
                marginTop: "24px",
                marginBottom: "20px",
                border: "2px solid #FCFBF4",
              }}
            >
              {status}
            </div>
            <div>
              <button
                style={{
                  ...styles.authButton,
                  opacity: authenticated ? 1 : 0.5,
                  cursor: authenticated ? "pointer" : "not-allowed",
                }}
                disabled={!authenticated}
                onClick={() => handleControl("start")}
              >
                Start
              </button>
              <button
                style={{ ...styles.authButton, marginRight: 0 }}
                onClick={() => handleControl("stop")}
              >
                Stop
              </button>
            </div>
            <p style={{ fontSize: "18px", marginTop: "24px", marginBottom: "34px" }}>
              Authenticated:{" "}
              <span style={{ color: authenticated ? "green" : "red" }}>
                {authenticated ? "✅" : "❌"}
              </span>
            </p>
          </div>

          <div
            style={{
              width: "55%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
            className="live-feed-card"
            id="live-feed-section"
          >
            <div
            style={{
              ...styles.sectionHeaderDiv,
              width: "100%",
              margin: "0 auto",
              padding: "12px 0",
              marginBottom: "0px",
              borderBottom: "4px solid #FCFBF4",
              borderRadius: "10px 10px 0 0",
              borderColor: "#462323",
            }}
          >
              <h2 style={{ margin: 0, fontSize: "38px", lineHeight: "1.1" }}>Live Feed</h2>
            </div>
            <div
              style={{
                ...styles.liveFeedBox,
                width: "100%",
                margin: "0 auto",
              }}
              className="live-feed-box"
              ref={logsBoxRef}
            >
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{logs}</pre>
            </div>
          </div>
        </div>
      </div>

      {/* Discovered Stocks */}
      <div style={styles.discoveryWrapper} id="discovery-section" className="discovery-wrapper">

        <div
          style={{ ...styles.sectionHeaderDiv, width: "75%", backgroundColor: "transparent", border: "none", color: "#FCFBF4" }}
          className="section-header"
        >
          <div
            style={{
              backgroundColor: "#462323",
                color: "#FCFBF4",
                padding: "12px 0",
                fontSize: "58px",
                fontWeight: "800",
                border: "4px solid #462323",
                borderRadius: "10px 10px 0 0",
              }}
            >
            Discovery
          </div>
        
{/* ✅ Discovery Progress Bar */}
<div
  style={{
    backgroundColor: "#FCFBF4",
    border: "4px solid #462323",
    borderRadius: "0 0 10px 10px",
    width: "85%",
    margin: "0 auto 10px",
    padding: "10px 0",
    textAlign: "center",
    color: "#462323",
    fontWeight: "bold",
    fontSize: "18px",
  }}
>
  <p style={{ margin: "20px 0 0 0" }}>
    <strong>{progress.status}</strong> —{" "}
    {progress.percent.toFixed(1)}% ({progress.eta} remaining)
  </p>
  <div
    style={{
      backgroundColor: "#837777ff",
      width: "93%",
      height: "25px",
      borderRadius: "8px",
      border: "2px solid #462323",
      margin: "10px auto",
      overflow: "hidden",
    }}
  >
    <div
      style={{
        width: `${progress.percent}%`,
        height: "100%",
        backgroundColor:
          progress.percent >= 100 ? "#05630bff" : "#7dc242",
        transition: "width 0.5s ease-in-out",
      }}
    ></div>
  </div>
</div>
</div>

        <div style={styles.discoveryGrid} className="discovery-grid">
          {discovered.length > 0 ? (
            discovered.slice(0, Math.min(cardsToShow, discovered.length)).map((item, i) => {
              const symbol = item.symbol || item;
              const url = `https://finance.yahoo.com/quote/${symbol}`;
              const arrow = (up) => (up ? "▲" : "▼");
              const arrowColor = (up) => (up ? "green" : "red");

             // --- Core metrics ---
const eps = numOr(item.eps, null);
const pe = numOr(item.pe, null);
const revenueChange = numOr(item.revenue, null);
const price = numOr(item.last_price, null);

// 🧩 Estimate previous quarter price if not provided by backend
const prevQuarterPrice = numOr(item.prev_quarter_price, price / (1 + (item.growth ?? 0) / 100));

// ✅ Calculate real growth percent change in price
const growth =
  prevQuarterPrice && prevQuarterPrice > 0
    ? ((price - prevQuarterPrice) / prevQuarterPrice) * 100
    : null;


            // --- Confidence mapping (A/B/C direct from backend) ---
              const confLetter = (item.confidence || "F").toUpperCase();
              const colorMap = { A: "#3cb043", B: "#7dc242", C: "#f0c93d", D: "#f28f3b", F: "#d94f4f" };
              const grade = confLetter;
              const color = colorMap[confLetter] || "#d94f4f";
              const inferredStrategy = () => {
                if (item.strategy) return item.strategy;
                if (item.rebound !== undefined || item.drop_5d !== undefined) return "5 Day Strategy";
                if (item.gain_3d !== undefined) return "3 Day Strategy";
                return null;
              };
              const strategyLabel = inferredStrategy() || "N/A";


              

              return (
                <a
                  key={`${symbol}-${i}`}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.stockCard}
                >
                  <div>
                    <div style={styles.stockTickerBox}>{symbol}</div>
                    <p style={styles.stockPrice}>
                      {price === null ? "N/A" : `$${price.toFixed(2)}`}
                    </p>
                    <table style={styles.metricTable}>
                      <tbody>
                        <tr>
<td style={styles.metricName}>EPS</td>
<td
  style={{
    ...styles.metricValue,
    color: eps > 0 ? "green" : eps < 0 ? "red" : "#462323",
    whiteSpace: "nowrap",
  }}
>
  {eps !== null ? `${eps.toFixed(1)}%` : "N/A"}
  <span
    style={{
      color: eps > 0 ? "green" : eps < 0 ? "red" : "#462323",
      marginLeft: "4px",
    }}
  >
    {eps > 0 ? "▲" : eps < 0 ? "▼" : ""}
  </span>
</td>

                        </tr>
                        <tr>
                          <td style={styles.metricName}>Revenue</td>
<td
  style={{
    ...styles.metricValue,
    color:
      revenueChange > 0
        ? "green"
        : revenueChange < 0
        ? "red"
        : "#462323",
    whiteSpace: "nowrap", // keeps value and arrow together
  }}
>
  {revenueChange !== null ? `${revenueChange.toFixed(1)}%` : "N/A"}
  <span
    style={{
      color:
        revenueChange > 0
          ? "green"
          : revenueChange < 0
          ? "red"
          : "#462323",
      marginLeft: "4px", // adds small spacing between number and arrow
    }}
  >
    {revenueChange > 0 ? "▲" : revenueChange < 0 ? "▼" : ""}
  </span>
</td>


                        </tr>
                        <tr>
                          <td style={styles.metricName}>P/E</td>
<td
  style={{
    ...styles.metricValue,
    color: pe > 0 ? "green" : pe < 0 ? "red" : "#462323",
    whiteSpace: "nowrap",
  }}
>
  {pe !== null ? `${pe.toFixed(1)}%` : "N/A"}
  <span
    style={{
      color: pe > 0 ? "green" : pe < 0 ? "red" : "#462323",
      marginLeft: "4px",
    }}
  >
    {pe > 0 ? "▲" : pe < 0 ? "▼" : ""}
  </span>
</td>

                        </tr>
                        <tr>
                          <td style={styles.metricName}>Growth</td>
<td
  style={{
    ...styles.metricValue,
    color: growth > 0 ? "green" : growth < 0 ? "red" : "#462323",
    whiteSpace: "nowrap",
  }}
>
  {growth !== null ? `${growth.toFixed(1)}%` : "N/A"}
  <span
    style={{
      color: growth > 0 ? "green" : growth < 0 ? "red" : "#462323",
      marginLeft: "4px",
    }}
  >
    {growth > 0 ? "▲" : growth < 0 ? "▼" : ""}
  </span>
</td>

                        </tr>
                      </tbody>
                    </table>

                    {/* Confidence Grade Badge */}
                    <div style={styles.confidenceBadge(color)}>
                      Confidence: {grade}
                    </div>
                    <div style={styles.strategyTag(color)}>
                      {strategyLabel}
                    </div>
                  </div>
                </a>
              );
            })
          ) : (
            // ✅ CAIMEO Placeholder Card
            <a
              href="https://finance.yahoo.com/quote/CAIMEO"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.stockCard}
            >
              <div>
                <div style={styles.stockTickerBox}>CAIMEO</div>
                <p style={styles.stockPrice}>$9.00</p>
                <table style={styles.metricTable}>
                  <tbody>
                    <tr>
                      <td style={styles.metricName}>EPS</td>
                      <td style={{ ...styles.metricValue, color: "green" }}>
                        2.0 <span style={{ color: "green" }}>▲</span>
                      </td>
                    </tr>
                    <tr>
                      <td style={styles.metricName}>Revenue</td>
                      <td style={{ ...styles.metricValue, color: "green" }}>
                        15% <span style={{ color: "green" }}>▲</span>
                      </td>
                    </tr>
                    <tr>
                      <td style={styles.metricName}>P/E</td>
                      <td style={{ ...styles.metricValue, color: "green" }}>
                        18.0 <span style={{ color: "green" }}>▲</span>
                      </td>
                    </tr>
                    <tr>
                      <td style={styles.metricName}>Growth</td>
                      <td style={styles.metricValue}>12%</td>
                    </tr>
                  </tbody>
                </table>
                <div style={styles.confidenceBadge("#3cb043")}>
                  Confidence: A
                </div>
                <div style={styles.strategyTag("#3cb043")}>
                  3-Day Momentum
                </div>
              </div>
            </a>
          )}
        </div>
      </div>

      {/* Portfolio + Open Orders */}
      <div style={{ ...styles.portfolioWrapper, paddingTop: "0px" }} id="portfolio-section" className="portfolio-wrapper">
        <div className="table-wrap" style={styles.tableWrap}>
        <table style={{ ...styles.table, width: "100%", border: "0" }}>
          <thead>
            <tr>
              <th style={{ ...styles.th, fontSize: "32px" }} colSpan={5}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "54px" }}>Portfolio</span>
                  <div
                    style={{
                      width: "100%",
                      backgroundColor: "#462323",
                      color: "#FCFBF4",
                      border: "2px solid #462323",
                      padding: "6px 8px",
                      fontSize: "22px",
                      fontWeight: "600",
                      borderRadius: "0px",
                    }}
                  >
                    {authenticated && account?.equity !== null
                      ? fmtMoney(account.equity)
                      : "Authenticate to view equity"}
                  </div>
                  <div>
                    <button style={styles.tradeButton} onClick={() => handleControl("start")}>
                      Start Live Trading
                    </button>
                    <button style={styles.tradeButton} onClick={() => handleControl("stop")}>
                      Stop Live Trading
                    </button>
                  </div>
                </div>
              </th>
            </tr>
            <tr>
              <th style={styles.th}>Symbol</th>
              <th style={styles.th}>Qty</th>
              <th style={styles.th}>Avg Price</th>
              <th style={styles.th}>Current Price</th>
              <th style={styles.th}>Gain/Loss</th>
            </tr>
          </thead>
          <tbody>
            {portfolio.length > 0 ? (
              portfolio.map((p, i) => {
                const gainLoss = calcGainLoss(p);
                const isGain = gainLoss >= 0;
                return (
                  <tr key={i}>
                    <td style={styles.td}>{p.symbol}</td>
                    <td style={styles.td}>{p.qty}</td>
                    <td style={styles.td}>${Number(p.avgPrice).toFixed(2)}</td>
                    <td style={styles.td}>${Number(p.currentPrice).toFixed(2)}</td>
                    <td
                      style={{
                        ...styles.gainLoss,
                        color: isGain ? "green" : "red",
                      }}
                    >
                      ${gainLoss}
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td style={styles.td}>CAIMEO</td>
                <td style={styles.td}>3</td>
                <td style={styles.td}>$6.00</td>
                <td style={styles.td}>$9.00</td>
                <td style={{ ...styles.gainLoss, color: "green" }}>$9.00</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <div className="table-wrap" style={styles.tableWrap}>
        <table style={{ ...styles.table, marginTop: "64px", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...styles.th, fontSize: "32px" }} colSpan={6}>
                Open Orders
              </th>
            </tr>
            <tr>
              <th style={styles.th}>Symbol</th>
              <th style={styles.th}>Side</th>
              <th style={styles.th}>Qty</th>
              <th style={styles.th}>Type</th>
              <th style={styles.th}>Limit/Stop</th>
              <th style={styles.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.length > 0 ? (
              orders.map((o, i) => (
                <tr key={i}>
                  <td style={styles.td}>{o.symbol}</td>
                  <td style={styles.td}>{o.side}</td>
                  <td style={styles.td}>{o.qty}</td>
                  <td style={styles.td}>{o.type}</td>
                  <td style={styles.td}>
                    {o.limit_price ? `$${Number(o.limit_price).toFixed(2)}` : o.stop_price ? `$${Number(o.stop_price).toFixed(2)}` : "—"}
                  </td>
                  <td style={styles.td}>{o.status}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td style={styles.td}>—</td>
                <td style={styles.td}>—</td>
                <td style={styles.td}>—</td>
                <td style={styles.td}>—</td>
                <td style={styles.td}>—</td>
                <td style={styles.td}>No open orders</td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
        <div className="table-wrap" style={styles.tableWrap}>
        <table style={{ ...styles.table, marginTop: "64px", width: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...styles.th, fontSize: "32px" }} colSpan={5}>
                Trade History
              </th>
            </tr>
            <tr>
              <th style={styles.th}>Symbol</th>
              <th style={styles.th}>Qty</th>
              <th style={styles.th}>Avg Price</th>
              <th style={styles.th}>Sold Price</th>
              <th style={styles.th}>Gain/Loss</th>
            </tr>
          </thead>
          <tbody>
            {authenticated ? (
              trades.length > 0 ? (
                trades.map((t, i) => {
                  const gainLoss = calcTradePnl(t);
                  const isGain = gainLoss !== null && gainLoss >= 0;
                  return (
                    <tr key={i}>
                      <td style={styles.td}>{t.symbol}</td>
                      <td style={styles.td}>{t.qty}</td>
                      <td style={styles.td}>
                        {t.avgPrice !== null && t.avgPrice !== undefined
                          ? `$${Number(t.avgPrice).toFixed(2)}`
                          : "—"}
                      </td>
                      <td style={styles.td}>
                        {t.soldPrice !== null && t.soldPrice !== undefined
                          ? `$${Number(t.soldPrice).toFixed(2)}`
                          : "—"}
                      </td>
                      <td
                        style={{
                          ...styles.gainLoss,
                          color: gainLoss === null ? "#462323" : isGain ? "green" : "red",
                        }}
                      >
                        {gainLoss === null ? "—" : `$${gainLoss}`}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td style={styles.td} colSpan={5}>
                    No trades yet.
                  </td>
                </tr>
              )
            ) : (
              <tr>
                <td style={styles.td} colSpan={5}>
                  Authenticate to view trade history.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>

    </div>
  );
}

export default App;
    tableWrap: {
      width: "100%",
      overflowX: "auto",
    },

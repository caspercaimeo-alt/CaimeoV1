import React, { useEffect, useState } from "react";

const SERVER = "https://caimeov1.onrender.com";

function App() {
  const [logs, setLogs] = useState("");
  const [status, setStatus] = useState("Stopped");
  const [discovered, setDiscovered] = useState([]);
  const [portfolio, setPortfolio] = useState([]);
  const [account, setAccount] = useState({ cash: 0, invested: 0 });
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

const top16 = sorted.slice(0, 16);
setDiscovered(top16);


    setMeta({
      total_scanned: 10000,
      after_filters: list.length,
      displayed: top16.length,
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
      if (data.cash !== undefined) setAccount(data);
    } catch {
      setAccount({ cash: 12500.42, invested: 8700.33 });
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

  // ---- Initial Data ----
  useEffect(() => {
    fetchDiscovered();
    fetchAccount();
    fetchPortfolio();
    fetchStatus();
    fetchProgress(); // start polling discovery progress

    const statusInterval = setInterval(() => {
      fetchStatus();
      fetchProgress();
    }, 5000);

    return () => clearInterval(statusInterval);
  }, []);


  const calcGainLoss = (p) => ((p.currentPrice - p.avgPrice) * p.qty).toFixed(2);
  const fmt1 = (v, suffix = "") => {
    if (v === null || v === undefined || Number.isNaN(Number(v)))
      return "N/A" + suffix;
    return Number(v).toFixed(1) + suffix;
  };
  const numOr = (v, fallback) =>
    v === null || v === undefined || Number.isNaN(Number(v))
      ? fallback
      : Number(v);

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
      backgroundImage: "url('/circuit_bg.png')",
      backgroundRepeat: "repeat",
      backgroundSize: "contain",
      color: "white",
      fontFamily: "Arial, sans-serif",
      minHeight: "100vh",
      overflowX: "hidden",
      overflowY: "auto",
      paddingTop: "60px",
      margin: 0,
      paddingBottom: "100px",
    },
    headerBox: {
      backgroundColor: "#462323",
      border: "12px solid white",
      borderRadius: "20px",
      width: "60%",
      margin: "0 auto 60px",
      textAlign: "center",
      padding: "20px 0",
    },
    title: {
      fontSize: "12vw",
      fontWeight: "800",
      color: "white",
      textAlign: "center",
      margin: 0,
    },
    authWrapper: {
      backgroundColor: "#837777ff",
      border: "8px solid #FCFBF4",
      borderRadius: "10px",
      width: "85%",
      margin: "0 auto 40px",
      padding: "20px 0 40px 0",
    },
    authHeader: {
      backgroundColor: "#462323",
      color: "#837777ff",
      border: "5px solid #FCFBF4",
      borderRadius: "10px",
      width: "50%",
      margin: "15px auto",
      textAlign: "center",
      padding: "10px 0",
      fontWeight: "bold",
      fontSize: "26px",
    },
    authBox: {
      backgroundColor: "#FCFBF4",
      border: "4px solid #462323",
      width: "65%",
      margin: "30px auto",
      textAlign: "center",
      padding: "50px 50px 30px",
      borderRadius: "8px",
      color: "black",
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
      padding: "10px 24px",
      marginTop: "10px",
      border: "3px solid #462323",
      borderRadius: "8px",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      fontWeight: "700",
      fontSize: "16px",
      cursor: "pointer",
    },
    statusBox: {
      backgroundColor: "#2d2d2dff",
      border: "8px solid #FCFBF4",
      borderRadius: "10px",
      padding: "25px 0",
      width: "60%",
      margin: "0 auto 30px",
      textAlign: "center",
    },
    sectionHeaderDiv: {
      backgroundColor: "#462323",
      border: "5px solid #FCFBF4",
      borderRadius: "10px",
      width: "60%",
      margin: "0 auto 20px",
      textAlign: "center",
      padding: "10px 0",
      color: "#837777ff",
      fontWeight: "bold",
      fontSize: "26px",
    },
    table: {
      width: "85%",
      margin: "0 auto",
      borderCollapse: "collapse",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      border: "4px solid #462323",
      borderRadius: "10px",
    },
    th: {
      border: "2px solid #462323",
      padding: "10px",
      backgroundColor: "#462323",
      color: "#FCFBF4",
      fontSize: "18px",
    },
    td: {
      border: "2px solid #462323",
      padding: "8px",
      fontSize: "16px",
    },
    gainLoss: {
      border: "2px solid #462323",
      width: "100px",
      textAlign: "center",
    },
    discoveryWrapper: {
      backgroundColor: "#837777ff",
      border: "8px solid #FCFBF4",
      borderRadius: "10px",
      width: "85%",
      margin: "0 auto 40px",
      padding: "30px 0",
    },
    discoveryGrid: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
      justifyItems: "center",
      gap: "2rem",
      width: "90%",
      margin: "0 auto",
    },
    stockCard: {
      border: "4px solid #462323",
      borderRadius: "8px",
      backgroundColor: "#FCFBF4",
      color: "#462323",
      width: "200px",
      textAlign: "center",
      textDecoration: "none",
      padding: "15px 10px",
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
      marginTop: "6px",
      padding: "4px 8px",
      borderRadius: "8px",
      fontSize: "13px",
      fontWeight: "bold",
      backgroundColor: color,
      color: "#FCFBF4",
      border: "1px solid #462323",
    }),
    liveFeedBox: {
      backgroundColor: "#FCFBF4",
      border: "4px solid #462323",
      borderRadius: "10px",
      width: "80%",
      margin: "0 auto",
      color: "#462323",
      padding: "20px",
      maxHeight: "300px",
      overflowY: "auto",
      fontFamily: "monospace",
    },
  };

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.headerBox}>
        <h1 style={styles.title}>CAIMEO</h1>
      </div>

      {/* Auth Section */}
      <div style={styles.authWrapper}>
        <div style={styles.authHeader}>
          <h2>API Authentication</h2>
        </div>
        <div style={styles.authBox}>
          <form onSubmit={submitKeys}>
            <input
              style={styles.authInput}
              type="text"
              placeholder="API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <br />
            <input
              style={styles.authInput}
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

      {/* Status Section */}
      <div style={styles.statusBox}>
        <h2>
          Status:{" "}
          <span style={{ color: status === "Running" ? "green" : "red" }}>
            {status}
          </span>
        </h2>
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
            style={styles.authButton}
            onClick={() => handleControl("stop")}
          >
            Stop
          </button>
        </div>
        <p style={{ fontSize: "22px" }}>
          Authenticated:{" "}
          <span style={{ color: authenticated ? "green" : "red" }}>
            {authenticated ? "✅" : "❌"}
          </span>
        </p>
      </div>

      {/* Portfolio */}
      <div style={styles.discoveryWrapper}>
        <div style={styles.sectionHeaderDiv}>
          <h2>Portfolio</h2>
        </div>
        <table style={styles.table}>
          <thead>
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

      {/* Discovered Stocks */}
      <div style={styles.discoveryWrapper}>

        <div style={styles.sectionHeaderDiv}>
          <h2>Discovery</h2>
        
{/* ✅ Discovery Progress Bar */}
<div
  style={{
    backgroundColor: "#FCFBF4",
    border: "5px solid #462323",
    borderRadius: "10px",
    width: "60%",
    margin: "10px auto",
    padding: "10px 0",
    textAlign: "center",
    color: "#462323",
    fontWeight: "bold",
    fontSize: "18px",
  }}
>
  <p>
    <strong>{progress.status}</strong> —{" "}
    {progress.percent.toFixed(1)}% ({progress.eta} remaining)
  </p>
  <div
    style={{
      backgroundColor: "#837777ff",
      width: "80%",
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

        <div style={styles.discoveryGrid}>
          {discovered.length > 0 ? (
            discovered.map((item, i) => {
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
              </div>
            </a>
          )}
        </div>
      </div>

      {/* Executed Trades / Live Feed */}
      <div style={styles.discoveryWrapper}>
        <div style={styles.sectionHeaderDiv}>
          <h2>Live Feed</h2>
        </div>
        <div style={styles.liveFeedBox}>
          <pre>{logs}</pre>
        </div>
      </div>
    </div>
  );
}

export default App;

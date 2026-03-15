import React, { useState, useRef, useEffect } from "react";
import { db } from "./firebaseConfig";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

// --- Time & Math Helpers ---
const now = new Date();
// Default to YYYY-MM formatted string for the <input type="month">
const currentMonthVal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

const calculateDaysUntil = (dayStr) => {
  const targetDay = parseInt(dayStr, 10);
  if (isNaN(targetDay) || targetDay < 1 || targetDay > 31) return null;
  
  let targetDate = new Date(now.getFullYear(), now.getMonth(), targetDay);
  if (targetDate.setHours(0,0,0,0) < now.setHours(0,0,0,0)) {
    targetDate.setMonth(targetDate.getMonth() + 1);
  }
  
  const diffTime = targetDate - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const fmtCur = (amount) => {
  const val = Number(amount) || 0;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
};

const fmtCurNeg = (amount) => {
  const val = Math.abs(Number(amount) || 0);
  return `(${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val)})`;
};

// Credit cards MUST have "CC" (or "Visa") in the name according to rules.
// Savings MUST NOT have "CC" in the name.

// Helper to check if string contains CC
const isCC = (name) => name && name.toUpperCase().includes("CC");

export default function FinanceApp() {
  const [budgetMonth, setBudgetMonth] = useState(currentMonthVal);
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    const handler = (e) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handler);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  // Initial State Models
  const [accounts, setAccounts] = useState([
    { id: 1, bank: "Mt.McKinley", bal: "", isHidden: false },
    { id: 2, bank: "Mt.MtKin CC.", bal: "", cycle: "", due: "", isHidden: false },
    { id: 3, bank: "Chase Savings", bal: "", isHidden: false },
    { id: 4, bank: "Chase CC.", bal: "", cycle: "", due: "", isHidden: false },
    { id: 5, bank: "SCB Dan's CC.", bal: "", cycle: "25", due: "5", isHidden: false },
    { id: 6, bank: "SCB Dan's ThaiVisa ..1856", bal: "", isHidden: false },
    { id: 7, bank: "SCB Main ..8875", bal: "", isHidden: false },
    { id: 8, bank: "SCB Na's CC.", bal: "", cycle: "25", due: "5", isHidden: false },
    { id: 9, bank: "SCB TLDC ..6268", bal: "", isHidden: false },
  ]);

  const updateAccount = (id, field, val) => {
    setAccounts(prev => prev.map(acc => acc.id === id ? { ...acc, [field]: val } : acc));
  };

  // Derived filtered lists based on the "CC" naming rule
  const creditCards = accounts.filter(acc => isCC(acc.bank));
  const savingsAccounts = accounts.filter(acc => !isCC(acc.bank));

  const totalCCUSD = creditCards.reduce((acc, cc) => cc.isHidden ? acc : acc + (Number(cc.bal.replace(/,/g, "")) || 0), 0);
  const totalCashUSD = savingsAccounts.reduce((acc, cash) => cash.isHidden ? acc : acc + (Number(cash.bal.replace(/,/g, "")) || 0), 0);
  const availableToTransfer = totalCashUSD - totalCCUSD;

  const handleSave = async () => {
    try {
      const docId = `${budgetMonth}-${Date.now()}`;
      await setDoc(doc(db, "budgets", docId), {
        budgetMonth, 
        baseCurrency: "USD",
        accounts,
        availableToTransfer,
        lastUpdated: serverTimestamp()
      });
      // Format it for the alert nicely ("March 2026")
      const d = new Date(budgetMonth + "-01T00:00:00");
      const niceLabel = d.toLocaleString("en-US", { month: "long", year: "numeric" });
      alert(`Successfully saved data for ${niceLabel}!`);
    } catch (e) {
      alert("Error saving: " + e.message);
    }
  };

  const appRef = useRef(null);

  const handleSharePDF = () => {
    // 1. Calculate the dynamic filename: TuckAway_MM_MONYY_On_DD-MM-YYYY
    const dateObj = new Date(budgetMonth + "-01T00:00:00");
    const monthNum = String(dateObj.getMonth() + 1).padStart(2, "0");
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const monthName = months[dateObj.getMonth()];
    const yearShort = String(dateObj.getFullYear()).slice(-2);
    
    const td = new Date();
    const tdDay = String(td.getDate()).padStart(2, '0');
    const tdMonth = String(td.getMonth() + 1).padStart(2, '0');
    const tdYear = td.getFullYear();

    const fileName = `TuckAway_${monthNum}_${monthName}${yearShort}_On_${tdDay}-${tdMonth}-${tdYear}`;
    
    // 2. Temporarily change doc title (browser uses this as the default filename)
    const originalTitle = document.title;
    document.title = fileName;
    
    // 3. Trigger print
    window.print();
    
    // 4. Restore original title after a short delay so the print dialog captures the new one
    setTimeout(() => {
      document.title = originalTitle;
    }, 100);
  };

  const currentMonthDisplay = new Date(budgetMonth + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });

  return (
    <div ref={appRef} style={{
      minHeight: "100vh", background: "#f8fafc", padding: "16px 8px 100px",
      fontFamily: "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", color: "#1e293b"
    }}>
      <style>{`
        input[type="month"]::-webkit-calendar-picker-indicator {
          opacity: 1;
          background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="15" viewBox="0 0 24 24"><path fill="%23ED1C24" d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z"/></svg>');
        }

        @media print {
          .print-hide { display: none !important; }
          .report-only { display: block !important; }
          body, html, #root { background: #fff !important; margin: 0; padding: 0; }
          div[style*="maxWidth"] { max-width: 100% !important; margin: 0 !important; width: 100% !important; }
          div[style*="boxShadow"] { box-shadow: none !important; border: 1px solid #eee !important; margin-bottom: 20px !important; break-inside: avoid; }
          h1, h2, h3, span, div { color: #000 !important; }
          input { border: 1px solid #ccc !important; }
          @page { size: auto; margin: 0.25in; }
        }
      `}</style>
      <div style={{ maxWidth: "500px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "10px" }}>

        {/* --- REPORT HEADER (Hidden in PWA, Shown in PDF) --- */}
        <div className="report-only" style={{ display: "none", textAlign: "center", marginBottom: "10px", borderBottom: "2px solid #000", paddingBottom: "10px" }}>
          <h1 style={{ margin: "0", fontSize: "28px", fontWeight: "900", color: "#000", textTransform: "uppercase" }}>
            Our TuckAway {currentMonthDisplay}
          </h1>
          <div style={{ fontSize: "16px", fontWeight: "700", color: "#000" }}>
            Generated on {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </div>
        </div>

        {/* --- HEADER --- */}
        <div className="print-hide" style={{
          background: "#ffffff", borderRadius: "16px", padding: "12px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.05)", border: "1px solid #e2e8f0"
        }}>
          {/* --- MAIN PWA HEADER --- */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: "4px", position: "relative" }}>
            {deferredPrompt && (
              <button 
                className="print-hide"
                onClick={handleInstall}
                title="Install App"
                style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", color: "#00247D", position: "absolute", left: 0 }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              </button>
            )}

            {/* Combined Clickable Title & Month */}
            <div style={{ position: "relative" }} className="print-hide">
              <h1 style={{ margin: 0, fontSize: "20px", fontWeight: "800", color: "#000", textAlign: "center", lineHeight: "1.2" }}>
                Our TuckAway <br/>
                <span style={{ color: "#ED1C24", fontSize: "18px" }}>{currentMonthDisplay}</span>
              </h1>
              <input 
                type="month" value={budgetMonth} onChange={(e) => setBudgetMonth(e.target.value)}
                style={{ 
                  position: "absolute", top: 0, left: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer", zIndex: 10
                }}
              />
            </div>

            <button 
              className="print-hide"
              onClick={handleSharePDF}
              title="Export to PDF"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "4px", color: "#000", position: "absolute", right: 0 }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="7px" fontWeight="bold" fontFamily="sans-serif">PDF</text>
              </svg>
            </button>
          </div>
          
          <div className="print-hide" style={{ textAlign: "center" }}>
            <label style={{ fontSize: "10px", color: "#64748b", fontWeight: "700", textTransform: "uppercase" }}>
              (TAP TO SELECT)
            </label>
          </div>
        </div>

        {/* --- SAVINGS ASSETS --- */}
        <Section title="Savings Accounts" themeColor="#000" bg="#fff" border="#000">
          {savingsAccounts.length === 0 && <p style={{fontSize: "13px", color: "#000", fontStyle: "italic"}}>No savings currently loaded.</p>}
          
          {savingsAccounts.map((acc, i) => (
             <React.Fragment key={acc.id}>

                
                {/* No Cycle/Due inputs for Savings */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: acc.isHidden ? "2px" : "8px" }}>
                  <div style={{ flex: 1.2, display: "flex", alignItems: "center", gap: "8px" }}>
                     <button className="print-hide" onClick={() => updateAccount(acc.id, "isHidden", !acc.isHidden)} style={{ 
                       width: "18px", height: "18px", borderRadius: "50%", padding: 0, 
                       background: acc.isHidden ? "#ED1C24" : "#00247D", 
                       border: "2px solid #000", cursor: "pointer", flexShrink: 0,
                       boxShadow: "inset 0 0 0 2px #fff"
                     }} aria-label="Toggle Visibility" />
                     <div style={{ 
                       width: "100%", 
                       background: acc.isHidden ? "transparent" : "#fff", 
                       borderRadius: "8px", 
                       border: acc.isHidden ? "none" : "1.5px solid #000", 
                       color: acc.isHidden ? "#94a3b8" : "#000", 
                       fontSize: acc.isHidden ? "13px" : "14px", 
                       fontWeight: "normal", 
                       padding: acc.isHidden ? "2px 0" : "5px 8px", 
                       boxSizing: "border-box", display: "flex", alignItems: "center" 
                     }}>
                       {acc.bank}
                     </div>
                  </div>
                  {!acc.isHidden && (
                    <div style={{ flex: 0.8 }}>
                       <CommaInput value={acc.bal} onChange={(val) => updateAccount(acc.id, "bal", val)} prefix="$" text="#000" bg="#fff" border="#000" />
                    </div>
                  )}
                </div>
             </React.Fragment>
          ))}
          
          
           <div style={{ marginTop: "16px", padding: "12px", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
             <span style={{ fontWeight: "800", color: "#000", fontSize: "14px", textTransform: "uppercase" }}>Savings Total:</span>
             <span style={{ fontWeight: "900", color: "#000", fontSize: "20px" }}>{fmtCur(totalCashUSD)}</span>
          </div>
        </Section>

        {/* --- CC SECTION --- */}
        <Section title="Credit Cards" themeColor="#000" bg="#fff" border="#000">
          {creditCards.length === 0 && <p style={{fontSize: "13px", color: "#000", fontStyle: "italic"}}>No cards currently loaded. Add an account with 'CC' in the name.</p>}

          {creditCards.map((cc, i) => (
            <React.Fragment key={cc.id}>

              
              <div style={{ display: "flex", gap: "10px", alignItems: cc.isHidden ? "center" : "flex-start", marginBottom: cc.isHidden ? "2px" : "12px" }}>
                {/* Toggle Button */}
                <button 
                  className="print-hide" 
                  onClick={() => updateAccount(cc.id, "isHidden", !cc.isHidden)}
                  style={{ 
                    marginTop: cc.isHidden ? "0" : "12px",
                    width: "18px", height: "18px", borderRadius: "50%", padding: 0, 
                    background: cc.isHidden ? "#ED1C24" : "#00247D", 
                    border: "2px solid #000", cursor: "pointer", flexShrink: 0,
                    boxShadow: "inset 0 0 0 2px #fff"
                  }} 
                  aria-label="Toggle Visibility"
                />

                {cc.isHidden ? (
                  <div style={{ 
                    color: "#94a3b8", fontSize: "14px", padding: "2px 0"
                  }}>
                    {cc.bank}
                  </div>
                ) : (
                  <div style={{ 
                    flex: 1, 
                    border: "2px solid #000", 
                    borderRadius: "12px", 
                    overflow: "hidden",
                    background: "#fff",
                    display: "flex"
                  }}>
                    {/* Left Column: Name & Cycle */}
                    <div style={{ flex: 1.2, display: "flex", flexDirection: "column", borderRight: "none" }}>
                      <div style={{ 
                        flex: 1,
                        padding: "8px 10px",
                        display: "flex",
                        alignItems: "center",
                        fontSize: "14px",
                        fontWeight: "700"
                      }}>
                        {cc.bank}
                      </div>
                      
                      <div style={{ 
                        padding: "4px 10px",
                        background: "#f8fafc",
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: "6px",
                        flexWrap: "nowrap"
                      }}>
                        <span style={{ fontSize: "9px", color: "#64748b", fontWeight: "700", textTransform: "uppercase", whiteSpace: "nowrap" }}>Cycle</span>
                        <input 
                          type="text" inputMode="numeric" placeholder="DD" 
                          value={cc.cycle || ""} 
                          onChange={e => updateAccount(cc.id, "cycle", e.target.value.replace(/\D/g,''))} 
                          style={{ 
                            width: "35px", background: "#fff", border: "1px solid #000", borderRadius: "4px", 
                            padding: "0", margin: "0", color: "#000", fontSize: "12px", fontWeight: "800", textAlign: "center", outline: "none", 
                            lineHeight: "20px", height: "20px", boxSizing: "border-box"
                          }} 
                        />
                        <div style={{ flexShrink: 0 }}>
                          <DaysIndicator days={calculateDaysUntil(cc.cycle)} type="cycle" />
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Amount & Due */}
                    <div style={{ flex: 0.8, display: "flex", flexDirection: "column" }}>
                      <div style={{ flex: 1 }}>
                        <CommaInput 
                          value={cc.bal} 
                          onChange={(val) => updateAccount(cc.id, "bal", val)} 
                          isNegative 
                          prefix="$" 
                          text="#000" 
                          bg="#fff" 
                          border="none" 
                        />
                      </div>

                      <div style={{ 
                        padding: "4px 10px",
                        background: "#f8fafc",
                        display: "flex",
                        flexDirection: "row",
                        alignItems: "center",
                        gap: "6px",
                        flexWrap: "nowrap"
                      }}>
                        <span style={{ fontSize: "9px", color: "#64748b", fontWeight: "700", textTransform: "uppercase", whiteSpace: "nowrap" }}>Due</span>
                        <input 
                          type="text" inputMode="numeric" placeholder="DD" 
                          value={cc.due || ""} 
                          onChange={e => updateAccount(cc.id, "due", e.target.value.replace(/\D/g,''))} 
                          style={{ 
                            width: "35px", background: "#fff", border: "1px solid #000", borderRadius: "4px", 
                            padding: "0", margin: "0", color: "#000", fontSize: "12px", fontWeight: "800", textAlign: "center", outline: "none", 
                            lineHeight: "20px", height: "20px", boxSizing: "border-box"
                          }} 
                        />
                        <div style={{ flexShrink: 0 }}>
                          <DaysIndicator days={calculateDaysUntil(cc.due)} type="due" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </React.Fragment>
          ))}
          
          
          <div style={{ marginTop: "16px", padding: "12px", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
             <span style={{ fontWeight: "800", color: "#000", fontSize: "14px", textTransform: "uppercase" }}>Total CC Due:</span>
             <span style={{ fontWeight: "900", color: "#000", fontSize: "20px" }}>{fmtCurNeg(totalCCUSD)}</span>
          </div>
        </Section>


        {/* --- TRANSFER TOTAL --- */}
        <div style={{ 
          background: "#fff", 
          borderRadius: "16px", 
          padding: "8px 12px", 
          border: "2px solid #000",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "10px"
        }}>
          <div style={{ fontSize: "11px", fontWeight: "800", color: "#ED1C24", textTransform: "uppercase", letterSpacing: "1px" }}>
            Available To Transfer
          </div>
          <div style={{ fontSize: "22px", fontWeight: "900", color: "#ED1C24" }}>
            {availableToTransfer >= 0 ? fmtCur(availableToTransfer) : fmtCurNeg(availableToTransfer)}
          </div>
        </div>




        {/* --- ACTIONS --- */}
        <div className="print-hide" style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "30px" }}>
          <button 
            onClick={handleSave}
            style={{ width: "100%", padding: "18px", borderRadius: "16px", border: "2px solid #000", background: "#f8fafc", color: "#000", fontSize: "16px", fontWeight: "900", textTransform: "uppercase", letterSpacing: "0.5px", cursor: "pointer", transition: "transform 0.1s" }}
            onMouseDown={e => e.currentTarget.style.transform = "scale(0.98)"}
            onMouseUp={e => e.currentTarget.style.transform = "scale(1)"}
          >
            SAVE BUDGET DATA
          </button>
        </div>

      </div>
    </div>
  );
}


// --- Reusable Sub-Components ---

const Section = ({ title, themeColor, bg, border, children }) => (
  <div style={{ background: bg, borderRadius: "16px", padding: "12px", border: `2px solid ${border}`, boxShadow: "0 4px 12px rgba(0,0,0,0.02)" }}>
    <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: "900", color: themeColor, display: "flex", alignItems: "center" }}>
      {title}
    </h2>
    {children}
  </div>
);



const CommaInput = ({ value, onChange, placeholder, isNegative, prefix, text, bg, border }) => {
  const handleInput = (e) => {
    let val = e.target.value.replace(/[^0-9.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) parts.pop();
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    onChange(parts.join('.'));
  };

  const borderStyle = border === "none" ? "none" : `1.5px solid ${border}`;

  return (
    <div style={{ display: "flex", alignItems: "center", background: bg, borderRadius: "8px", padding: "5px 8px", border: borderStyle, width: "100%", boxSizing: "border-box" }}>
      <span style={{ color: text, fontWeight: "800", marginRight: "2px", fontSize: "14px" }}>
        {isNegative ? `(${prefix}` : prefix}
      </span>
      <input 
        type="text" inputMode="decimal" value={value} onChange={handleInput} placeholder={placeholder || "0.00"}
        style={{ width: "100%", background: "transparent", border: "none", color: text, fontSize: "16px", fontWeight: "800", outline: "none", textAlign: "right", padding: 0 }}
      />
      {isNegative && <span style={{ color: text, fontWeight: "800", marginLeft: "2px", fontSize: "14px" }}>)</span>}
    </div>
  );
};

const DaysIndicator = ({ days, type }) => {
  if (days === null) return <div style={{ fontSize: "10px", height: "12px" }}></div>;
  
  let content;
  if (days === 0) {
    content = type === "cycle" ? "Cycles Today!" : "DUE TODAY";
  } else if (days < 0) {
    content = `${Math.abs(days)}d ago`;
  } else {
    content = <>In <span style={{color: "red"}}>{days}</span> d</>;
  }

  return <div style={{ fontSize: "10px", color: "#000", fontWeight: "normal", letterSpacing: "0.2px", opacity: 0.7 }}>{content}</div>;
};

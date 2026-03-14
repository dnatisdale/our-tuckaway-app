import React, { useState, useRef } from "react";
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

  // Initial State Models
  const [accounts, setAccounts] = useState([
    { id: 1, bank: "Mt.McKinley ..2586,..9744", bal: "", isHidden: false },
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

  const handleSharePDF = async () => {
    if (!appRef.current) return;
    
    // Show report-only elements and hide UI elements
    const elementsToHide = document.querySelectorAll(".print-hide");
    const reportElements = document.querySelectorAll(".report-only");
    
    elementsToHide.forEach(el => el.style.display = "none");
    reportElements.forEach(el => el.style.display = "block");

    try {
      // 1. Snapshot the HTML Element
      const canvas = await html2canvas(appRef.current, { 
        scale: 2, 
        useCORS: true, 
        backgroundColor: "#ffffff",
        onclone: (clonedDoc) => {
          // Remove shadows and borders for the "Report" look in the PDF
          const cards = clonedDoc.querySelectorAll('[style*="boxShadow"]');
          cards.forEach(c => {
            c.style.boxShadow = "none";
            c.style.border = "1px solid #eee";
          });
        }
      });

      const imgData = canvas.toDataURL("image/png");

      // 2. Create the PDF Document
      // A4 size by default, dimensions are 210x297mm
      const pdf = new jsPDF("p", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);

      // Build specific Date Label (e.g., 03_MAR26)
      const dateObj = new Date(budgetMonth + "-01T00:00:00");
      const monthNum = String(dateObj.getMonth() + 1).padStart(2, "0");
      const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
      const monthName = months[dateObj.getMonth()];
      const yearShort = String(dateObj.getFullYear()).slice(-2);
      
      // Build Today Label (e.g., 14-03-2026)
      const td = new Date();
      const tdDay = String(td.getDate()).padStart(2, '0');
      const tdMonth = String(td.getMonth() + 1).padStart(2, '0');
      const tdYear = td.getFullYear();

      // 3. Prompt user download: TuckAway_03_MAR26_On_14-03-2026.pdf
      const fileName = `TuckAway_${monthNum}_${monthName}${yearShort}_On_${tdDay}-${tdMonth}-${tdYear}.pdf`;
      pdf.save(fileName);

    } catch (e) {
      alert("Error generating PDF: " + e.message);
    } finally {
      // Restore UI
      elementsToHide.forEach(el => el.style.display = "");
      reportElements.forEach(el => el.style.display = "none");
    }
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
      `}</style>
      <div style={{ maxWidth: "500px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "16px" }}>

        {/* --- REPORT HEADER (Hidden in PWA, Shown in PDF) --- */}
        <div className="report-only" style={{ display: "none", textAlign: "center", marginBottom: "20px", borderBottom: "2px solid #000", paddingBottom: "10px" }}>
          <h1 style={{ margin: "0", fontSize: "28px", fontWeight: "900", color: "#000", textTransform: "uppercase" }}>
            Budget Report
          </h1>
          <div style={{ fontSize: "16px", fontWeight: "700", color: "#000" }}>
            Generated on {new Date().toLocaleDateString("en-US")}
          </div>
        </div>

        {/* --- HEADER --- */}
        <div style={{
          background: "#ffffff", borderRadius: "16px", padding: "20px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.05)", border: "1px solid #e2e8f0"
        }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", marginBottom: "16px", position: "relative" }}>
            <h1 className="print-hide" style={{ margin: 0, fontSize: "24px", fontWeight: "800", color: "#000", textAlign: "center" }}>
              Our TuckAway
            </h1>
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
          
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
            {/* Centered Decorative Month Display */}
            <div style={{ 
              fontSize: "18px", fontWeight: "800", color: "#ED1C24", textAlign: "center", 
              pointerEvents: "none", zIndex: 1
            }}>
              {currentMonthDisplay}
            </div>
            
            {/* Invisible Input Layer for Interaction */}
            <input 
              type="month" value={budgetMonth} onChange={(e) => setBudgetMonth(e.target.value)}
              style={{ 
                position: "absolute", top: 0, opacity: 0, width: "160px", height: "100%", cursor: "pointer", zIndex: 2
              }}
            />
            
            <label style={{ fontSize: "10px", color: "#64748b", fontWeight: "700", textTransform: "uppercase", marginTop: "6px" }}>
              (TAP TO SELECT)
            </label>
          </div>
        </div>

        {/* --- SAVINGS ASSETS --- */}
        <Section title="Savings Accounts" themeColor="#000" bg="#fff" border="#000">
          {savingsAccounts.length === 0 && <p style={{fontSize: "13px", color: "#000", fontStyle: "italic"}}>No savings currently loaded.</p>}
          
          {savingsAccounts.map((acc, i) => (
             <React.Fragment key={acc.id}>
                {i > 0 && <div style={{ height: "1px", background: "#e2e8f0", margin: acc.isHidden ? "6px 0" : "14px 0" }}></div>}
                
                {/* No Cycle/Due inputs for Savings */}
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: acc.isHidden ? "2px" : "0" }}>
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
                       padding: acc.isHidden ? "2px 0" : "10px 12px", 
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
          
          
           <div style={{ marginTop: "16px", padding: "12px", background: "#f8fafc", borderTop: "2px solid #000", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
             <span style={{ fontWeight: "800", color: "#000", fontSize: "14px", textTransform: "uppercase" }}>Savings Total:</span>
             <span style={{ fontWeight: "900", color: "#000", fontSize: "20px" }}>{fmtCur(totalCashUSD)}</span>
          </div>
        </Section>

        {/* --- CC SECTION --- */}
        <Section title="Credit Cards" themeColor="#000" bg="#fff" border="#000">
          {creditCards.length === 0 && <p style={{fontSize: "13px", color: "#000", fontStyle: "italic"}}>No cards currently loaded. Add an account with 'CC' in the name.</p>}

          {creditCards.map((cc, i) => (
            <React.Fragment key={cc.id}>
              {i > 0 && <div style={{ height: "1px", background: "#e2e8f0", margin: cc.isHidden ? "6px 0" : "14px 0" }}></div>}
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: cc.isHidden ? "2px" : "12px" }}>
                 <div style={{ flex: 1.2, display: "flex", alignItems: "center", gap: "8px" }}>
                    <button className="print-hide" onClick={() => updateAccount(cc.id, "isHidden", !cc.isHidden)} style={{ 
                      width: "18px", height: "18px", borderRadius: "50%", padding: 0, 
                      background: cc.isHidden ? "#ED1C24" : "#00247D", 
                      border: "2px solid #000", cursor: "pointer", flexShrink: 0,
                      boxShadow: "inset 0 0 0 2px #fff"
                    }} aria-label="Toggle Visibility" />
                    <div style={{ 
                      width: "100%", 
                      background: cc.isHidden ? "transparent" : "#fff", 
                      borderRadius: "8px", 
                      border: cc.isHidden ? "none" : "1.5px solid #000", 
                      color: cc.isHidden ? "#94a3b8" : "#000", 
                      fontSize: cc.isHidden ? "13px" : "14px", 
                      fontWeight: "normal", 
                      padding: cc.isHidden ? "2px 0" : "10px 12px", 
                      boxSizing: "border-box", display: "flex", alignItems: "center" 
                    }}>
                      {cc.bank}
                    </div>
                 </div>
                 {!cc.isHidden && (
                   <div style={{ flex: 0.8 }}>
                      <CommaInput value={cc.bal} onChange={(val) => updateAccount(cc.id, "bal", val)} isNegative prefix="$" text="#000" bg="#fff" border="#000" />
                   </div>
                 )}
              </div>

              {!cc.isHidden && (
                <div style={{ display: "flex", gap: "10px", paddingLeft: "10px", paddingRight: "10px" }}>
                  {/* Cycle Date */}
                  <div style={{ flex: 1, background: "#fff", borderRadius: "8px", padding: "6px 10px", border: "1px solid #000" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                         <span style={{ fontSize: "11px", color: "#000", fontWeight: "normal", textTransform: "uppercase" }}>Cycle</span>
                         <input type="number" min="1" max="31" placeholder="DD" value={cc.cycle || ""} onChange={e => updateAccount(cc.id, "cycle", e.target.value)} style={{ width: "35px", background: "#f8fafc", border: "1px solid #000", borderRadius: "4px", padding: "2px", color: "#000", fontSize: "13px", fontWeight: "normal", outline: "none", textAlign: "center" }} />
                      </div>
                      <DaysIndicator days={calculateDaysUntil(cc.cycle)} type="cycle" />
                    </div>
                  </div>

                  {/* Due Date */}
                  <div style={{ flex: 1, background: "#fff", borderRadius: "8px", padding: "6px 10px", border: "1px solid #000" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                         <span style={{ fontSize: "11px", color: "#000", fontWeight: "normal", textTransform: "uppercase" }}>Due</span>
                         <input type="number" min="1" max="31" placeholder="DD" value={cc.due || ""} onChange={e => updateAccount(cc.id, "due", e.target.value)} style={{ width: "35px", background: "#f8fafc", border: "1px solid #000", borderRadius: "4px", padding: "2px", color: "#000", fontSize: "13px", fontWeight: "normal", outline: "none", textAlign: "center" }} />
                      </div>
                      <DaysIndicator days={calculateDaysUntil(cc.due)} type="due" />
                    </div>
                  </div>
                </div>
              )}
            </React.Fragment>
          ))}
          
          
          <div style={{ marginTop: "16px", padding: "12px", background: "#f8fafc", borderTop: "2px solid #000", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
             <span style={{ fontWeight: "800", color: "#000", fontSize: "14px", textTransform: "uppercase" }}>Total CC Due:</span>
             <span style={{ fontWeight: "900", color: "#000", fontSize: "20px" }}>{fmtCurNeg(totalCCUSD)}</span>
          </div>
        </Section>


        {/* --- ROBINHOOD TRANSFER --- */}
        <div style={{ background: "#000", borderRadius: "16px", padding: "26px 20px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)" }}>
          <div style={{ fontSize: "12px", fontWeight: "800", color: "#f8fafc", textTransform: "uppercase", letterSpacing: "1px" }}>
            Available To Transfer
          </div>
          <div style={{ fontSize: "38px", fontWeight: "900", color: "#ffffff", margin: "4px 0 10px", wordBreak: "break-all" }}>
            {availableToTransfer >= 0 ? fmtCur(availableToTransfer) : fmtCurNeg(availableToTransfer)}
          </div>
          <div style={{ fontSize: "14px", fontWeight: "700", color: "#e2e8f0", display: "flex", alignItems: "center", gap: "6px" }}>
            → Send to Robinhood
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
  <div style={{ background: bg, borderRadius: "16px", padding: "20px", border: `2px solid ${border}`, boxShadow: "0 4px 12px rgba(0,0,0,0.02)" }}>
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

  return (
    <div style={{ display: "flex", alignItems: "center", background: bg, borderRadius: "8px", padding: "8px 10px", border: `1.5px solid ${border}`, width: "100%", boxSizing: "border-box" }}>
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

  return <div style={{ fontSize: "10px", color: "#000", fontWeight: "normal", textAlign: "right", letterSpacing: "0.2px", opacity: 0.7 }}>{content}</div>;
};

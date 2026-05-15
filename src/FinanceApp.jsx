import React, { useState, useRef, useEffect } from "react";
import { db } from "./firebaseConfig";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

// --- Time & Math Helpers ---
const now = new Date();
// Default to YYYY-MM formatted string for the <input type="month">
const currentMonthVal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

const normalizeDecimalString = (value, decimals = 2) => {
  const num = parseFloat(String(value || "").replace(/,/g, ""));
  if (Number.isNaN(num)) return "";
  return num.toFixed(decimals);
};

const cleanDayInput = (value) => {
  const digitsOnly = String(value || "")
    .replace(/\D/g, "")
    .slice(0, 2);
  if (!digitsOnly) return "";

  const dayNum = parseInt(digitsOnly, 10);
  if (Number.isNaN(dayNum) || dayNum < 1) return "";
  if (dayNum > 31) return "31";

  return digitsOnly;
};

const calculateDaysUntil = (dayStr, referenceDateStr) => {
  const targetDay = parseInt(dayStr, 10);
  if (isNaN(targetDay) || targetDay < 1 || targetDay > 31) return null;

  // referenceDateStr is YYYY-MM-DD
  const [refYear, refMonth, refDay] = referenceDateStr.split("-").map(Number);
  const refDate = new Date(refYear, refMonth - 1, refDay);
  refDate.setHours(0, 0, 0, 0);

  let targetDate = new Date(refYear, refMonth - 1, targetDay);
  targetDate.setHours(0, 0, 0, 0);

  // If the target day has already passed in the reference month, move to next month
  if (targetDate < refDate) {
    targetDate.setMonth(targetDate.getMonth() + 1);
  }

  const diffTime = targetDate - refDate;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

const fmtCur = (amount) => {
  const val = Number(String(amount || "").replace(/,/g, "")) || 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(val);
};

const fmtCurNeg = (amount) => {
  const val = Math.abs(Number(String(amount || "").replace(/,/g, "")) || 0);
  return `-${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val)}`;
};

const parseMoneyValue = (value) =>
  Number(String(value || "").replace(/,/g, "")) || 0;

const csvEscape = (value) => {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const makeSafeFilePart = (value) =>
  String(value || "")
    .trim()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "") || "Budget";

const makeDateTimeStamp = (date = new Date()) => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
};

// --- Shared Money Style Constants ---
const CC_MONEY_COLOR = "#A51931";
const MONEY_FONT_SIZE = "15px";
const MONEY_FONT_WEIGHT = "900";
const TOTAL_FONT_SIZE = "17px";
const AVAILABLE_TRANSFER_FONT_SIZE = "24px";

const CC_MONEY_FONT_SIZE = MONEY_FONT_SIZE;
const CC_MONEY_FONT_WEIGHT = MONEY_FONT_WEIGHT;
const CC_TOTAL_FONT_SIZE = TOTAL_FONT_SIZE;

const DAY_INPUT_STYLE = {
  width: "24px",
  height: "22px",
  background: "#fff",
  border: "1.5px solid #000",
  borderRadius: "5px",
  fontSize: "13px",
  fontWeight: "900",
  color: "#000",
  textAlign: "center",
  padding: "0",
  outline: "none",
  boxSizing: "border-box",
};

// Credit cards MUST have "CC" (or "Visa") in the name according to rules.
// Savings MUST NOT have "CC" in the name.

// Helper to check if string contains CC
const isCC = (name) => name && name.toUpperCase().includes("CC");

export default function FinanceApp() {
  const [budgetMonth] = useState(currentMonthVal);
  const [referenceDate, setReferenceDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [subject, setSubject] = useState(
    () => localStorage.getItem("tuckaway_subject") || "",
  );
  const [deferredPrompt, setDeferredPrompt] = useState(null);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener("beforeinstallprompt", handler);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstall = async () => {
    const isAlreadyInstalled =
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      window.navigator.standalone === true;

    if (isAlreadyInstalled) {
      alert("Our TuckAway is already installed on this device.");
      return;
    }

    if (!deferredPrompt) {
      alert(
        "Chrome is not ready to show the install prompt yet. Make sure you are using Chrome, open the app from localhost or your HTTPS website, then use Chrome's menu ⋮ > Cast, save, and share > Install page/app if needed.",
      );
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDeferredPrompt(null);
    }
  };

  const handleShareApp = async () => {
    const shareUrl = window.location.href;
    const shareTitle = subject ? `Our TuckAway - ${subject}` : "Our TuckAway";
    const shareText = "Open Our TuckAway budget app.";

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl,
        });
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        alert("Share link copied to the clipboard.");
        return;
      }

      window.prompt("Copy this share link:", shareUrl);
    } catch (error) {
      if (error?.name === "AbortError") return;
      window.prompt("Copy this share link:", shareUrl);
    }
  };

  const handleClearAll = () => {
    const ok = window.confirm(
      "Clear all account amounts? This keeps account names, hidden/show settings, CYCLE days, DUE days, the THB rate, and the subject.",
    );

    if (!ok) return;

    setAccounts((prev) =>
      prev.map((acc) => ({
        ...acc,
        bal: "",
        balTHB: "",
        rate: "",
      })),
    );
  };

  const initialAccounts = [
    { id: 1, bank: "Mt.McKinley", bal: "", isHidden: false },
    {
      id: 2,
      bank: "Mt.McKin CC.",
      bal: "",
      cycle: "",
      due: "",
      isHidden: false,
    },
    { id: 3, bank: "Chase Savings", bal: "", isHidden: false },
    { id: 4, bank: "Chase CC.", bal: "", cycle: "", due: "", isHidden: false },
    {
      id: 5,
      bank: "SCB Dan's CC.",
      bal: "",
      balTHB: "",
      rate: "",
      cycle: "",
      due: "",
      isHidden: false,
    },
    {
      id: 6,
      bank: "SCB Dan's ThaiVisa ..1856",
      bal: "",
      balTHB: "",
      rate: "",
      isHidden: false,
    },
    {
      id: 7,
      bank: "SCB Main ..8875",
      bal: "",
      balTHB: "",
      rate: "",
      isHidden: false,
    },
    {
      id: 8,
      bank: "SCB Na's CC.",
      bal: "",
      balTHB: "",
      rate: "",
      cycle: "",
      due: "",
      isHidden: false,
    },
    {
      id: 9,
      bank: "SCB TLDC ..6268",
      bal: "",
      balTHB: "",
      rate: "",
      isHidden: false,
    },
  ];

  const [accounts, setAccounts] = useState(() => {
    const saved = localStorage.getItem("tuckaway_accounts");
    return saved ? JSON.parse(saved) : initialAccounts;
  });

  useEffect(() => {
    localStorage.setItem("tuckaway_accounts", JSON.stringify(accounts));
  }, [accounts]);

  const [scbSavingsExpanded, setScbSavingsExpanded] = useState(true);
  const [scbCCExpanded, setScbCCExpanded] = useState(true);
  const [globalRate, setGlobalRate] = useState(
    () =>
      normalizeDecimalString(
        localStorage.getItem("tuckaway_rate") || "35.00",
      ) || "35.00",
  );

  useEffect(() => {
    localStorage.setItem("tuckaway_subject", subject);
  }, [subject]);

  const updateGlobalRate = (nextRate) => {
    setGlobalRate(nextRate);
    localStorage.setItem("tuckaway_rate", nextRate);

    const rate = parseFloat(nextRate) || 0;

    setAccounts((prev) =>
      prev.map((acc) => {
        if (!acc.bank.startsWith("SCB") || !acc.balTHB || rate <= 0) {
          return acc;
        }

        const thb = parseFloat(acc.balTHB.replace(/,/g, "")) || 0;
        const usd = thb / rate;

        return {
          ...acc,
          bal: usd.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }),
        };
      }),
    );
  };

  const clearAndTurnOffScbGroup = (groupType) => {
    setAccounts((prev) =>
      prev.map((acc) => {
        const isScb = acc.bank.startsWith("SCB");
        if (!isScb) return acc;

        const isScbCreditCard = isCC(acc.bank);
        const shouldClear =
          groupType === "credit" ? isScbCreditCard : !isScbCreditCard;

        if (!shouldClear) return acc;

        return {
          ...acc,
          bal: "",
          balTHB: "",
          isHidden: true,
        };
      }),
    );
  };

  const toggleScbSavings = () => {
    if (scbSavingsExpanded) {
      clearAndTurnOffScbGroup("savings");
    }
    setScbSavingsExpanded(!scbSavingsExpanded);
  };

  const toggleScbCreditCards = () => {
    if (scbCCExpanded) {
      clearAndTurnOffScbGroup("credit");
    }
    setScbCCExpanded(!scbCCExpanded);
  };

  const updateAccount = (id, field, val) => {
    setAccounts((prev) =>
      prev.map((acc) => {
        if (acc.id !== id) return acc;
        const updated = { ...acc, [field]: val };

        // Auto-calculate USD balance if THB or Rate changes
        if (field === "balTHB" || field === "rate" || field === "forceUpdate") {
          const thb = parseFloat(updated.balTHB.replace(/,/g, "")) || 0;
          const rate =
            parseFloat(
              field === "forceUpdate" ? val : updated.rate || globalRate,
            ) || 0;
          if (rate > 0) {
            const usd = thb / rate;
            updated.bal = usd.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });
            // Ensure THB entry has 2 decimals if it's a number
            if (field === "balTHB" && val.includes(".")) {
              // Allow typing decimals
            }
          }
        }
        return updated;
      }),
    );
  };

  const creditCards = accounts.filter((acc) => isCC(acc.bank));
  const savingsAccounts = accounts.filter((acc) => !isCC(acc.bank));

  const totalCCUSD = creditCards.reduce(
    (acc, cc) => (cc.isHidden ? acc : acc + parseMoneyValue(cc.bal)),
    0,
  );
  const totalCashUSD = savingsAccounts.reduce(
    (acc, cash) => (cash.isHidden ? acc : acc + parseMoneyValue(cash.bal)),
    0,
  );
  const availableToTransfer = totalCashUSD - totalCCUSD;

  const handleSave = async () => {
    try {
      const docId = `${budgetMonth}-${Date.now()}`;
      await setDoc(doc(db, "budgets", docId), {
        budgetMonth,
        subject,
        baseCurrency: "USD",
        accounts,
        availableToTransfer,
        lastUpdated: serverTimestamp(),
      });

      const d = new Date(budgetMonth + "-01T00:00:00");
      const niceLabel = d.toLocaleString("en-US", {
        month: "long",
        year: "numeric",
      });
      alert(`Successfully saved data for ${niceLabel}!`);
    } catch (e) {
      alert("Error saving: " + e.message);
    }
  };

  const appRef = useRef(null);

  const handleSharePDF = () => {
    const dateObj = new Date(budgetMonth + "-01T00:00:00");
    const monthNum = String(dateObj.getMonth() + 1).padStart(2, "0");
    const months = [
      "JAN",
      "FEB",
      "MAR",
      "APR",
      "MAY",
      "JUN",
      "JUL",
      "AUG",
      "SEP",
      "OCT",
      "NOV",
      "DEC",
    ];
    const monthName = months[dateObj.getMonth()];
    const yearShort = String(dateObj.getFullYear()).slice(-2);

    const td = new Date();
    const tdDay = String(td.getDate()).padStart(2, "0");
    const tdMonth = String(td.getMonth() + 1).padStart(2, "0");
    const tdYear = td.getFullYear();

    const fileName = `TuckAway_${monthNum}_${monthName}${yearShort}_On_${tdDay}-${tdMonth}-${tdYear}`;

    const originalTitle = document.title;
    document.title = fileName;

    window.print();

    setTimeout(() => {
      document.title = originalTitle;
    }, 100);
  };

  const handleExportCSV = () => {
    const exportedAt = new Date();
    const budgetDate = new Date(budgetMonth + "-01T00:00:00");
    const budgetLabel = budgetDate.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    const subjectLabel = subject.trim() || budgetLabel;
    const fileName = `TuckAway_${makeSafeFilePart(subjectLabel)}_${makeDateTimeStamp(exportedAt)}.csv`;

    const rows = [
      ["Our TuckAway CSV Export"],
      ["Subject", subjectLabel],
      ["Budget Month", budgetLabel],
      ["As Of", referenceDate],
      ["THB Rate", globalRate],
      ["Exported At", exportedAt.toLocaleString("en-US")],
      [],
      [
        "Section",
        "Account",
        "THB Amount",
        "USD Amount",
        "Cycle Day",
        "Due Day",
        "Days Until Cycle",
        "Days Until Due",
        "Hidden",
      ],
      ...savingsAccounts.map((acc) => [
        "Savings",
        acc.bank,
        acc.balTHB || "",
        parseMoneyValue(acc.bal).toFixed(2),
        "",
        "",
        "",
        "",
        acc.isHidden ? "Yes" : "No",
      ]),
      ...creditCards.map((acc) => [
        "Credit Card",
        acc.bank,
        acc.balTHB || "",
        parseMoneyValue(acc.bal).toFixed(2),
        acc.cycle || "",
        acc.due || "",
        calculateDaysUntil(acc.cycle, referenceDate) ?? "",
        calculateDaysUntil(acc.due, referenceDate) ?? "",
        acc.isHidden ? "Yes" : "No",
      ]),
      [],
      ["Savings Total", "", "", totalCashUSD.toFixed(2)],
      ["Total CC Due", "", "", totalCCUSD.toFixed(2)],
      ["Available To Transfer", "", "", availableToTransfer.toFixed(2)],
    ];

    const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const currentMonthDisplay = new Date(
    budgetMonth + "-01T00:00:00",
  ).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const getBalanceColor = (val, isDebt) => {
    if (isDebt) return "#A51931";
    const num =
      typeof val === "string" ? parseFloat(val.replace(/,/g, "")) : val;
    if (!num || num === 0) return "#94a3b8";
    if (num < 0) return "#A51931";
    return "#000";
  };

  return (
    <div
      ref={appRef}
      style={{
        minHeight: "100vh",
        background: "#f8fafc",
        padding: "16px 8px 100px",
        fontFamily: "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#1e293b",
      }}
    >
      <style>{`
        input[type="month"]::-webkit-calendar-picker-indicator {
          opacity: 1;
          background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="15" viewBox="0 0 24 24"><path fill="%23A51931" d="M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z"/></svg>');
        }
        
        .black-calendar::-webkit-calendar-picker-indicator {
          filter: grayscale(1) brightness(0);
          cursor: pointer;
        }


        .cc-card-shell {
          min-width: 0;
        }


        .cc-item-row {
          display: flex !important;
          flex-direction: column !important;
          gap: 4px !important;
          align-items: stretch !important;
          padding-left: 0 !important;
        }

        .scb-group-toggle {
          flex-direction: row-reverse !important;
          justify-content: space-between !important;
          align-items: center !important;
          gap: 8px !important;
        }

        .scb-group-toggle > span {
          flex: 1 1 auto !important;
        }

        .scb-group-toggle > div {
          flex: 0 0 auto !important;
        }

        .cc-top-row {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) minmax(100px, 120px) !important;
          gap: 10px !important;
          align-items: center !important;
        }

        .cc-scb-top-row {
          grid-template-columns: minmax(0, 1fr) auto !important;
        }

        .cc-name-box {
          min-width: 0 !important;
          overflow: hidden !important;
          white-space: nowrap !important;
          text-overflow: ellipsis !important;
          box-sizing: border-box !important;
        }

        .cc-amount-pair {
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          min-width: 0 !important;
        }

        .cc-thb-wrap {
          width: 96px;
          min-width: 96px;
        }

        .cc-usd-wrap {
          width: 104px;
          min-width: 104px;
        }

        .cc-thb-wrap > div,
        .cc-usd-wrap {
          height: 32px !important;
          min-height: 32px !important;
          padding-top: 3px !important;
          padding-bottom: 3px !important;
        }

        .cc-dates-row {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
          gap: 8px !important;
          align-items: center !important;
        }

        .cc-date-group {
          display: flex !important;
          align-items: center !important;
          gap: 6px !important;
          min-width: 0 !important;
          white-space: nowrap !important;
        }

        .cc-date-spacer {
          display: none !important;
        }

        .cc-day-input {
          flex: 0 0 36px !important;
        }

        @media (max-width: 520px) {
          .cc-item-row {
            grid-template-columns: 18px minmax(0, 1fr) !important;
            gap: 3px !important;
            margin-bottom: 10px !important;
          }

          .scb-cc-item-row {
            padding-left: 0 !important;
          }

          .cc-card-shell {
            border-radius: 10px !important;
          }

          .cc-top-row {
            padding: 8px !important;
            gap: 8px !important;
          }

          .cc-standard-top-row {
            grid-template-columns: minmax(0, 1fr) minmax(92px, 112px) !important;
          }

          .cc-scb-top-row {
            grid-template-columns: minmax(0, 1fr) !important;
          }

          .cc-amount-pair {
            width: 100% !important;
            display: grid !important;
            grid-template-columns: 96px 104px !important;
            justify-content: end !important;
            gap: 8px !important;
          }

          .cc-thb-wrap {
            width: 96px !important;
            min-width: 96px !important;
          }

          .cc-usd-wrap {
            width: 104px !important;
            min-width: 104px !important;
          }

          .cc-dates-row {
            padding: 6px 8px !important;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) !important;
            gap: 6px !important;
          }

          .cc-date-group {
            gap: 4px !important;
          }

          .cc-date-label {
            font-size: 9px !important;
          }

          .cc-day-input {
            flex-basis: 28px !important;
            width: 28px !important;
            height: 21px !important;
            font-size: 12px !important;
          }
        }

        @media (max-width: 390px) {
          .cc-dates-row {
            grid-template-columns: 1fr !important;
          }

          .cc-date-group {
            justify-content: flex-start !important;
          }
        }


        @media (max-width: 430px) {
          .header-actions-row {
            gap: 4px !important;
          }
          .header-actions-row button {
            width: 32px !important;
            height: 32px !important;
            padding: 0 !important;
          }
          .header-actions-row button svg {
            width: 16px !important;
            height: 16px !important;
          }
        }

        @media print {
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print-hide { display: none !important; }
          .report-only { display: block !important; }
          .cc-item-row { display: block !important; width: 100% !important; margin-bottom: 4px !important; }
          .cc-card-shell { width: 100% !important; box-sizing: border-box !important; }
          .cc-top-row { padding: 6px 10px 4px !important; }
          .cc-dates-row { padding: 4px 10px !important; }
          .cc-top-row, .cc-dates-row { box-sizing: border-box !important; }
          body, html, #root { background: #fff !important; margin: 0; padding: 0; }
          div { box-shadow: none !important; }
          @page { size: auto; margin: 0.25in; }
        }
      `}</style>

      <div
        style={{
          maxWidth: "500px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}
      >
        <div
          className="report-only"
          style={{
            display: "none",
            textAlign: "center",
            marginBottom: "0px",
          }}
        >
          <h1
            style={{
              margin: "0",
              fontSize: "28px",
              fontWeight: "900",
              color: "#000",
              textTransform: "uppercase",
            }}
          >
            Our TuckAway {subject ? `- ${subject}` : currentMonthDisplay}
          </h1>
        </div>

        <div
          className="print-hide"
          style={{
            background: "#ffffff",
            borderRadius: "16px",
            padding: "12px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
            border: "2px solid #000",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <div
            className="header-actions-row"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "6px",
              width: "100%",
            }}
          >
            <button
              onClick={handleInstall}
              title="Install Our TuckAway"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "36px",
                height: "36px",
                background: "#FF3B30",
                border: "2px solid #000",
                borderRadius: "8px",
                cursor: "pointer",
                padding: "0",
                color: "#000",
                boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>

            <button
              onClick={handleShareApp}
              title="Share Our TuckAway"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "36px",
                height: "36px",
                background: "#FFCC00",
                border: "2px solid #000",
                borderRadius: "8px",
                cursor: "pointer",
                padding: "0",
                color: "#000",
                boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="18" cy="5" r="3"></circle>
                <circle cx="6" cy="12" r="3"></circle>
                <circle cx="18" cy="19" r="3"></circle>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
              </svg>
            </button>

            <button
              onClick={handleClearAll}
              title="Clear all account amounts"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "36px",
                height: "36px",
                background: "#3399FF",
                border: "2px solid #000",
                borderRadius: "8px",
                cursor: "pointer",
                padding: "0",
                color: "#000",
                boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                <path d="M10 11v6"></path>
                <path d="M14 11v6"></path>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
              </svg>
            </button>

            <button
              onClick={handleSharePDF}
              title="Print"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "36px",
                height: "36px",
                background: "#34C759",
                border: "2px solid #000",
                borderRadius: "8px",
                cursor: "pointer",
                padding: "0",
                color: "#000",
                boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
            </button>
          </div>

          <div style={{ textAlign: "center" }}>
            <h1
              style={{
                margin: 0,
                fontSize: "22px",
                fontWeight: "900",
                color: "#00247D",
                lineHeight: "1.2",
                fontFamily: "'Trebuchet MS', 'Segoe UI', Arial, sans-serif",
                letterSpacing: "0.2px",
              }}
            >
              Our TuckAway
            </h1>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                marginTop: "6px",
              }}
            >
              <span
                style={{
                  color: "#000",
                  fontSize: "17px",
                  fontWeight: "900",
                  lineHeight: 1,
                }}
              >
                Subject:
              </span>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder=""
                aria-label="Budget subject"
                style={{
                  width: `${Math.max(subject.length, 1)}ch`,
                  minWidth: "1ch",
                  maxWidth: "230px",
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid #A51931",
                  color: "#A51931",
                  fontSize: "17px",
                  fontWeight: "900",
                  fontFamily: "inherit",
                  outline: "none",
                  padding: "0 0 3px",
                  textAlign: "left",
                  lineHeight: 1.1,
                }}
              />
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
            }}
          >
            {/* Global Exchange Rate Input */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
              <a
                href="https://www.xe.com/currencyconverter/convert/?Amount=1&From=USD&To=THB"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  fontSize: "10px",
                  fontWeight: "900",
                  color: "#0000EE",
                  textDecoration: "underline",
                  whiteSpace: "nowrap",
                }}
              >
                XE.com USD to THB
              </a>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  background: "#f1f5f9",
                  padding: "2px 6px",
                  borderRadius: "8px",
                  border: "1.5px solid #000",
                }}
              >
                <span
                  style={{ fontSize: "10px", fontWeight: "900", color: "#000" }}
                >
                  THB Rate:
                </span>
              <input
                type="text"
                inputMode="decimal"
                value={globalRate}
                onChange={(e) => {
                  let val = e.target.value.replace(/[^0-9.]/g, "");
                  const parts = val.split(".");
                  if (parts.length > 2) {
                    val = parts[0] + "." + parts.slice(1).join("");
                  }
                  let [whole, fraction] = val.split(".");
                  if (whole && whole.length > 2) whole = whole.slice(0, 2);
                  if (fraction && fraction.length > 2) fraction = fraction.slice(0, 2);
                  updateGlobalRate(fraction !== undefined ? `${whole}.${fraction}` : whole);
                }}
                onBlur={(e) =>
                  updateGlobalRate(
                    normalizeDecimalString(e.target.value) || "35.00",
                  )
                }
                style={{
                  width: `${Math.max(globalRate.length, 4)}ch`,
                  background: "transparent",
                  border: "none",
                  borderBottom: "1px solid #A51931",
                  fontSize: "12px",
                  fontWeight: "900",
                  color: "#A51931",
                  textAlign: "center",
                  outline: "none",
                  padding: "0 0 1px",
                }}
              />
            </div>
          </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "#f1f5f9",
                padding: "2px 6px",
                borderRadius: "8px",
                border: "1.5px solid #000",
              }}
            >
              <span
                style={{ fontSize: "10px", fontWeight: "900", color: "#000" }}
              >
                As of:
              </span>
              <input
                type="date"
                className="black-calendar"
                value={referenceDate}
                onChange={(e) => setReferenceDate(e.target.value)}
                style={{
                  width: "115px",
                  background:
                    "linear-gradient(#A51931, #A51931) left calc(100% - 1px) / 10ch 1px no-repeat",
                  border: "none",
                  fontSize: "12px",
                  fontWeight: "900",
                  color: "#A51931",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  padding: "0",
                  outline: "none",
                }}
              />
            </div>
          </div>


        </div>

        <Section
          title="Savings Accounts"
          themeColor="#000"
          bg="#fff"
          border="#000"
        >
          {savingsAccounts.length === 0 && (
            <p style={{ fontSize: "13px", color: "#000", fontStyle: "italic" }}>
              No savings currently loaded.
            </p>
          )}

          {savingsAccounts
            .filter((acc) => !acc.bank.startsWith("SCB"))
            .map((acc) => (
              <React.Fragment key={acc.id}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginBottom: acc.isHidden ? "2px" : "8px",
                  }}
                >
                  <div
                    style={{
                      flex: 1.2,
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <div
                      onClick={() => updateAccount(acc.id, "isHidden", !acc.isHidden)}
                      style={{
                        width: "100%",
                        background: acc.isHidden ? "transparent" : "#fff",
                        borderRadius: "8px",
                        border: acc.isHidden ? "none" : "1.5px solid #000",
                        color: acc.isHidden ? "#94a3b8" : "#000",
                        fontSize: acc.isHidden ? "13px" : "14px",
                        fontWeight: "normal",
                        padding: acc.isHidden ? "2px 0" : "5px 8px",
                        boxSizing: "border-box",
                        display: "flex",
                        alignItems: "center",
                        cursor: "pointer",
                        textDecoration: acc.isHidden ? "line-through" : "none",
                      }}
                      title={acc.isHidden ? "Click to Include" : "Click to Exclude"}
                    >
                      {acc.bank}
                    </div>
                  </div>

                  {!acc.isHidden && (
                    <div style={{ flex: 0.8 }}>
                      <CommaInput
                        value={acc.bal}
                        onChange={(val) => updateAccount(acc.id, "bal", val)}
                        prefix="$"
                        bg="#fff"
                        border="#000"
                        isDebt={false}
                      />
                    </div>
                  )}
                </div>
              </React.Fragment>
            ))}

          {/* SCB Savings Group */}
          <div style={{ marginTop: "4px", marginBottom: "8px" }}>
            <button
              className="scb-group-toggle"
              onClick={toggleScbSavings}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexDirection: "row-reverse",
                gap: "8px",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px 0",
                width: "100%",
                textAlign: "left",
              }}
            >
              <div
                style={{
                  color: "#A51931",
                  transform: scbSavingsExpanded
                    ? "rotate(0deg)"
                    : "rotate(-90deg)",
                  transition: "transform 0.2s",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "800",
                  color: "#A51931",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                SCB Thailand Savings
              </span>
            </button>

            {scbSavingsExpanded &&
              savingsAccounts
                .filter((acc) => acc.bank.startsWith("SCB"))
                .map((acc) => (
                  <React.Fragment key={acc.id}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginBottom: "8px",
                        paddingLeft: "0",
                      }}
                    >
                      <div
                        style={{
                          flex: 1.2,
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <div
                          onClick={() => updateAccount(acc.id, "isHidden", !acc.isHidden)}
                          style={{
                            width: "100%",
                            background: acc.isHidden ? "transparent" : "#fff",
                            borderRadius: "8px",
                            border: acc.isHidden ? "none" : "1.5px solid #000",
                            color: acc.isHidden ? "#94a3b8" : "#000",
                            fontSize: acc.isHidden ? "13px" : "14px",
                            fontWeight: "normal",
                            padding: acc.isHidden ? "2px 0" : "5px 8px",
                            boxSizing: "border-box",
                            display: "flex",
                            alignItems: "center",
                            cursor: "pointer",
                            textDecoration: acc.isHidden ? "line-through" : "none",
                          }}
                          title={acc.isHidden ? "Click to Include" : "Click to Exclude"}
                        >
                          {acc.bank}
                        </div>
                      </div>

                      {!acc.isHidden && (
                        <div
                          style={{
                            flex: 1.2,
                            display: "flex",
                            gap: "8px",
                            alignItems: "center",
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <CommaInput
                              value={acc.balTHB || ""}
                              onChange={(val) =>
                                updateAccount(acc.id, "balTHB", val)
                              }
                              placeholder="0.00"
                              prefix="฿"
                              bg="#fff"
                              border="#000"
                              isDebt={false}
                            />
                          </div>
                          <div
                            style={{
                              flex: 1,
                              background: "#f8fafc",
                              borderRadius: "8px",
                              border: "1.5px solid #000",
                              padding: "5px 8px",
                              height: "32px",
                              fontSize: MONEY_FONT_SIZE,
                              fontWeight: MONEY_FONT_WEIGHT,
                              color: getBalanceColor(acc.bal, false),
                              textAlign: "right",
                              display: "flex",
                              justifyContent: "flex-end",
                              alignItems: "center",
                              boxSizing: "border-box",
                            }}
                          >
                            {fmtCur(acc.bal)}
                          </div>
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                ))}
          </div>

          <div
            style={{
              marginTop: "16px",
              padding: "12px",
              background: "#f8fafc",
              border: "1.5px solid #000",
              borderRadius: "8px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontWeight: MONEY_FONT_WEIGHT,
                color: "#000",
                fontSize: TOTAL_FONT_SIZE,
                textTransform: "uppercase",
              }}
            >
              Savings Total:
            </span>
            <span
              style={{
                fontWeight: MONEY_FONT_WEIGHT,
                color: "#000",
                fontSize: TOTAL_FONT_SIZE,
              }}
            >
              {fmtCur(totalCashUSD)}
            </span>
          </div>
        </Section>

        <Section title="Credit Cards" themeColor="#000" bg="#fff" border="#000">
          {creditCards.length === 0 && (
            <p style={{ fontSize: "13px", color: "#000", fontStyle: "italic" }}>
              No cards currently loaded. Add an account with 'CC' in the name.
            </p>
          )}

          {creditCards
            .filter((cc) => !cc.bank.startsWith("SCB"))
            .map((cc) => (
              <React.Fragment key={cc.id}>
                <div
                  className="cc-item-row"
                  style={{
                    display: "flex",
                    gap: "10px",
                    alignItems: cc.isHidden ? "center" : "flex-start",
                    marginBottom: cc.isHidden ? "2px" : "12px",
                    width: "100%",
                  }}
                >
                  {cc.isHidden ? (
                    <div
                      onClick={() => updateAccount(cc.id, "isHidden", false)}
                      style={{
                        color: "#94a3b8",
                        fontSize: "14px",
                        padding: "2px 0",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        cursor: "pointer",
                        textDecoration: "line-through",
                      }}
                      title="Click to Include"
                    >
                      {cc.bank}
                    </div>
                  ) : (
                    <div
                      className="cc-card-shell"
                      style={{
                        flex: 1,
                        width: "100%",
                        border: "2px solid #000",
                        borderRadius: "12px",
                        overflow: "hidden",
                        background: "#fff",
                      }}
                    >
                      {/* Top Row: Name and Balance */}
                      <div
                        className="cc-top-row cc-standard-top-row"
                        style={{
                          padding: "10px 12px 6px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <div
                          className="cc-name-box"
                          onClick={() => updateAccount(cc.id, "isHidden", true)}
                          style={{
                            flex: 1,
                            background: "#fff",
                            borderRadius: "8px",
                            border: "1.5px solid #000",
                            padding: "5px 10px",
                            fontSize: "14px",
                            fontWeight: "normal",
                            color: "#000",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            cursor: "pointer",
                          }}
                          title="Click to Exclude"
                        >
                          {cc.bank}
                        </div>
                        <div
                          className="cc-standard-amount"
                          style={{ width: "120px" }}
                        >
                          <CommaInput
                            value={cc.bal}
                            onChange={(val) => updateAccount(cc.id, "bal", val)}
                            prefix="$"
                            bg="#fff"
                            border="#000"
                            isDebt={true}
                            isNegative={true}
                          />
                        </div>
                      </div>

                      {/* Bottom Row: Dates */}
                      <div
                        className="cc-dates-row"
                        style={{
                          padding: "6px 12px",
                          background: "#f8fafc",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          borderTop: "1px solid #eee",
                        }}
                      >
                        <div
                          className="cc-date-group"
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <span
                            className="cc-date-label"
                            style={{
                              fontSize: "10px",
                              color: "#64748b",
                              fontWeight: "800",
                              textTransform: "uppercase",
                            }}
                          >
                            Due
                          </span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={cc.due || ""}
                            onChange={(e) =>
                              updateAccount(
                                cc.id,
                                "due",
                                cleanDayInput(e.target.value),
                              )
                            }
                            className="cc-day-input"
                            style={DAY_INPUT_STYLE}
                          />
                          <DaysIndicator
                            days={calculateDaysUntil(cc.due, referenceDate)}
                            type="due"
                          />
                        </div>
                        <div
                          className="cc-date-spacer"
                          style={{ width: "20px" }}
                        ></div>
                        <div
                          className="cc-date-group"
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          <span
                            className="cc-date-label"
                            style={{
                              fontSize: "10px",
                              color: "#64748b",
                              fontWeight: "800",
                              textTransform: "uppercase",
                            }}
                          >
                            Cycle
                          </span>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={cc.cycle || ""}
                            onChange={(e) =>
                              updateAccount(
                                cc.id,
                                "cycle",
                                cleanDayInput(e.target.value),
                              )
                            }
                            className="cc-day-input"
                            style={DAY_INPUT_STYLE}
                          />
                          <DaysIndicator
                            days={calculateDaysUntil(cc.cycle, referenceDate)}
                            type="cycle"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </React.Fragment>
            ))}

          {/* SCB Credit Card Group */}
          <div style={{ marginTop: "4px", marginBottom: "8px" }}>
            <button
              className="scb-group-toggle"
              onClick={toggleScbCreditCards}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexDirection: "row-reverse",
                gap: "8px",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px 0",
                width: "100%",
                textAlign: "left",
              }}
            >
              <div
                style={{
                  color: "#A51931",
                  transform: scbCCExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                  transition: "transform 0.2s",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "800",
                  color: "#A51931",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                SCB Thailand Credit Cards
              </span>
            </button>

            {scbCCExpanded &&
              creditCards
                .filter((cc) => cc.bank.startsWith("SCB"))
                .map((cc) => (
                  <React.Fragment key={cc.id}>
                    <div
                      className="cc-item-row scb-cc-item-row"
                      style={{
                        display: "flex",
                        gap: "10px",
                        alignItems: "flex-start",
                        marginBottom: "12px",
                        paddingLeft: "0",
                        width: "100%",
                      }}
                    >
                  {cc.isHidden ? (
                    <div
                      onClick={() => updateAccount(cc.id, "isHidden", false)}
                      style={{
                        color: "#94a3b8",
                        fontSize: "14px",
                        padding: "2px 0",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        cursor: "pointer",
                        textDecoration: "line-through",
                      }}
                      title="Click to Include"
                    >
                      {cc.bank}
                    </div>
                  ) : (
                    <div
                      className="cc-card-shell"
                      style={{
                        flex: 1,
                        width: "100%",
                        border: "2px solid #000",
                        borderRadius: "12px",
                        overflow: "hidden",
                        background: "#fff",
                      }}
                    >
                      {/* Top Row: Name, THB, and Balance */}
                      <div
                        className="cc-top-row cc-scb-top-row"
                        style={{
                          padding: "10px 12px 6px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <div
                          className="cc-name-box"
                          onClick={() => updateAccount(cc.id, "isHidden", true)}
                          style={{
                            flex: 1,
                            background: "#fff",
                            borderRadius: "8px",
                            border: "1.5px solid #000",
                            padding: "5px 10px",
                            fontSize: "14px",
                            fontWeight: "normal",
                            color: "#000",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-start",
                            cursor: "pointer",
                          }}
                          title="Click to Exclude"
                        >
                          {cc.bank}
                        </div>
                          <div
                            className="cc-amount-pair"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <div
                              className="cc-thb-wrap"
                              style={{ width: "96px" }}
                            >
                              <CommaInput
                                value={cc.balTHB || ""}
                                onChange={(val) =>
                                  updateAccount(cc.id, "balTHB", val)
                                }
                                placeholder="0.00"
                                prefix="฿"
                                bg="#fff"
                                border="#000"
                                isDebt={true}
                              />
                            </div>
                            <div
                              className="cc-usd-wrap"
                              style={{
                                width: "110px",
                                background: "#f8fafc",
                                borderRadius: "8px",
                                border: "1.5px solid #000",
                                padding: "5px 8px",
                                height: "32px",
                                display: "flex",
                                justifyContent: "flex-end",
                                alignItems: "center",
                                boxSizing: "border-box",
                              }}
                            >
                              <span
                                style={{
                                  color: CC_MONEY_COLOR,
                                  fontSize: CC_MONEY_FONT_SIZE,
                                  fontWeight: CC_MONEY_FONT_WEIGHT,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {fmtCurNeg(cc.bal)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Bottom Row: Dates */}
                        <div
                          className="cc-dates-row"
                          style={{
                            padding: "6px 12px",
                            background: "#f8fafc",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            borderTop: "1px solid #eee",
                          }}
                        >
                          <div
                            className="cc-date-group"
                            style={{
                              flex: 1,
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <span
                              className="cc-date-label"
                              style={{
                                fontSize: "10px",
                                color: "#64748b",
                                fontWeight: "800",
                                textTransform: "uppercase",
                              }}
                            >
                              Due
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={cc.due || ""}
                              onChange={(e) =>
                                updateAccount(
                                  cc.id,
                                  "due",
                                  cleanDayInput(e.target.value),
                                )
                              }
                              className="cc-day-input"
                              style={DAY_INPUT_STYLE}
                            />
                            <DaysIndicator
                              days={calculateDaysUntil(cc.due, referenceDate)}
                              type="due"
                            />
                          </div>
                          <div
                            className="cc-date-spacer"
                            style={{ width: "20px" }}
                          ></div>
                          <div
                            className="cc-date-group"
                            style={{
                              flex: 1,
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <span
                              className="cc-date-label"
                              style={{
                                fontSize: "10px",
                                color: "#64748b",
                                fontWeight: "800",
                                textTransform: "uppercase",
                              }}
                            >
                              Cycle
                            </span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={cc.cycle || ""}
                              onChange={(e) =>
                                updateAccount(
                                  cc.id,
                                  "cycle",
                                  cleanDayInput(e.target.value),
                                )
                              }
                              className="cc-day-input"
                              style={DAY_INPUT_STYLE}
                            />
                            <DaysIndicator
                              days={calculateDaysUntil(cc.cycle, referenceDate)}
                              type="cycle"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  </React.Fragment>
                ))}
          </div>

          <div
            style={{
              marginTop: "16px",
              padding: "12px",
              background: "#f8fafc",
              border: "1.5px solid #000",
              borderRadius: "8px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontWeight: CC_MONEY_FONT_WEIGHT,
                color: CC_MONEY_COLOR,
                fontSize: CC_TOTAL_FONT_SIZE,
                textTransform: "uppercase",
              }}
            >
              Total CC Due:
            </span>
            <span
              style={{
                fontWeight: CC_MONEY_FONT_WEIGHT,
                color: CC_MONEY_COLOR,
                fontSize: CC_TOTAL_FONT_SIZE,
              }}
            >
              {fmtCurNeg(totalCCUSD)}
            </span>
          </div>
        </Section>

        <div
          style={{
            background: "#fff",
            borderRadius: "16px",
            padding: "8px 12px",
            border: "2px solid #000",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "clamp(4px, 2vw, 10px)",
            flexWrap: "nowrap",
            whiteSpace: "nowrap",
          }}
        >
          <div
            style={{
              fontSize: "clamp(12px, 4.5vw, 19px)",
              fontWeight: MONEY_FONT_WEIGHT,
              color: "#000",
              textTransform: "uppercase",
              letterSpacing: "clamp(0px, 0.5vw, 1px)",
            }}
          >
            Funds to Transfer
          </div>
          <div
            style={{
              fontSize: "clamp(15px, 6vw, 24px)",
              fontWeight: MONEY_FONT_WEIGHT,
              color: CC_MONEY_COLOR,
              textDecorationLine: "underline",
              textDecorationThickness: "2px",
              textUnderlineOffset: "4px",
            }}
          >
            {availableToTransfer >= 0
              ? fmtCur(availableToTransfer)
              : fmtCurNeg(availableToTransfer)}
          </div>
        </div>

        <div
          className="print-hide"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            marginBottom: "30px",
          }}
        >
          <button
            onClick={handleSave}
            style={{
              alignSelf: "center",
              width: "fit-content",
              padding: "10px 22px",
              borderRadius: "10px",
              border: "2px solid #7A1023",
              background: "#A51931",
              color: "#ffffff",
              fontSize: "15px",
              fontWeight: "900",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              cursor: "pointer",
              boxShadow: "0 3px 6px rgba(0,0,0,0.18)",
              transition: "transform 0.1s, background 0.15s",
            }}
            onMouseDown={(e) =>
              (e.currentTarget.style.transform = "scale(0.98)")
            }
            onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#7A1023")}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#A51931";
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            SAVE BUDGET DATA
          </button>

          <button
            onClick={handleExportCSV}
            style={{
              alignSelf: "center",
              width: "fit-content",
              padding: "10px 22px",
              borderRadius: "10px",
              border: "2px solid #A51931",
              background: "#ffffff",
              color: "#A51931",
              fontSize: "15px",
              fontWeight: "900",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              cursor: "pointer",
              boxShadow: "0 3px 6px rgba(0,0,0,0.12)",
              transition: "transform 0.1s, background 0.15s, color 0.15s",
            }}
            onMouseDown={(e) =>
              (e.currentTarget.style.transform = "scale(0.98)")
            }
            onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#A51931";
              e.currentTarget.style.color = "#ffffff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#ffffff";
              e.currentTarget.style.color = "#A51931";
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            EXPORT SPREADSHEET
          </button>
        </div>
      </div>
    </div>
  );
}

const Section = ({ title, themeColor, bg, border, children }) => (
  <div
    style={{
      background: bg,
      borderRadius: "16px",
      padding: "10px",
      border: `2px solid ${border}`,
      boxShadow: "0 4px 12px rgba(0,0,0,0.02)",
    }}
  >
    <h2
      style={{
        margin: "0 0 16px",
        fontSize: "17px",
        fontWeight: "900",
        color: themeColor,
        display: "flex",
        alignItems: "center",
      }}
    >
      {title}
    </h2>
    {children}
  </div>
);

const CommaInput = ({
  value,
  onChange,
  placeholder,
  prefix,
  bg,
  border,
  isDebt = false,
  isNegative = false,
}) => {
  const inputRef = React.useRef(null);
  const numValue = parseFloat(value.replace(/,/g, "")) || 0;

  // Savings: gray placeholder, black when filled
  // Debt (CC): always CC_MONEY_COLOR
  let textColor;
  if (isDebt || numValue < 0) {
    textColor = CC_MONEY_COLOR;
  } else {
    textColor = !value || numValue === 0 ? "#94a3b8" : "#000";
  }

  const handleInput = (e) => {
    let val = e.target.value.replace(/[^0-9.]/g, "");
    const parts = val.split(".");
    if (parts.length > 2) {
      val = parts[0] + "." + parts.slice(1).join("");
      const newParts = val.split(".");
      parts[0] = newParts[0];
      parts[1] = newParts[1];
      parts.length = 2;
    }

    // Do not allow values like 0,350.
    // 0350 becomes 350, while 0.35 stays 0.35.
    parts[0] = (parts[0] || "").replace(/^0+(?=\d)/, "");
    if (parts[0] === "" && parts.length > 1) {
      parts[0] = "0";
    }

    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    
    if (parts[1] !== undefined) {
      parts[1] = parts[1].slice(0, 2);
    }
    
    onChange(parts.join("."));
  };

  const handleBlur = () => {
    if (!value) return;
    const num = parseFloat(value.replace(/,/g, ""));
    if (!isNaN(num)) {
      const formatted = num.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      if (formatted !== value) {
        onChange(formatted);
      }
    }
  };

  const borderStyle = border === "none" ? "none" : `1.5px solid ${border}`;
  const rawDisplayText = value || placeholder || "0.00";
  const displayText = `${isNegative ? "-" : ""}${prefix}${rawDisplayText}`;
  const inputWidth = `${Math.max(displayText.length, 4)}ch`;

  // Shared money style for this input
  const moneyStyle = isDebt
    ? {
        color: CC_MONEY_COLOR,
        fontSize: CC_MONEY_FONT_SIZE,
        fontWeight: CC_MONEY_FONT_WEIGHT,
      }
    : {
        color: textColor,
        fontSize: MONEY_FONT_SIZE,
        fontWeight: MONEY_FONT_WEIGHT,
      };

  return (
    <div
      onClick={() => inputRef.current && inputRef.current.focus()}
      style={{
        display: "flex",
        alignItems: "center",
        background: bg,
        borderRadius: "8px",
        height: "32px",
        padding: "3px 7px",
        border: borderStyle,
        width: "100%",
        boxSizing: "border-box",
        justifyContent: "flex-end",
        cursor: "text",
      }}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={displayText}
        onChange={handleInput}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={handleBlur}
        aria-label="Money amount"
        style={{
          width: inputWidth,
          background: "transparent",
          border: "none",
          outline: "none",
          textAlign: "right",
          padding: "0",
          margin: "0",
          lineHeight: 1,
          fontFamily: "inherit",
          ...moneyStyle,
        }}
      />
    </div>
  );
};

const DaysIndicator = ({ days, type }) => {
  let content;
  if (days === null) {
    content = (
      <>
        In <span style={{ color: "#A51931" }}>--</span> Days
      </>
    );
  } else if (days === 0) {
    content = type === "cycle" ? "Cycles Today!" : "DUE TODAY";
  } else if (days < 0) {
    content = `${Math.abs(days)} Days ago`;
  } else {
    content = (
      <>
        In <span style={{ color: "#A51931" }}>{days}</span> Days
      </>
    );
  }

  return (
    <div
      style={{
        fontSize: "11px",
        color: "#000",
        fontWeight: "700",
        whiteSpace: "nowrap",
        lineHeight: 1,
      }}
    >
      {content}
    </div>
  );
};

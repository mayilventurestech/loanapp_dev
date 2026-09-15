import React, { useState, useEffect } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import iLendQLogo from './ILendQWhiteBG.png';
import { loginUser } from './api/login';
import { getCustomers, createCustomer } from './api/customers';
import { getEmployees, createEmployee } from './api/employees';

// --- FINANCIAL & DATE HELPER FUNCTIONS ---

const roundFinance = (amount) => {
  return Math.round(Number(amount));
};

const fmtRupee = (amount) => {
  const sign = amount < 0 ? "-" : "";
  const absVal = Math.abs(amount);
  return `${sign}₹${absVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const FREQUENCY_CONFIG = {
  "Monthly": { periods_per_year: 12, period_reference_days: 30 },
  "Biweekly": { periods_per_year: 26, period_reference_days: 14 },
  "Weekly": { periods_per_year: 52, period_reference_days: 7 },
};

const addTime = (dateObj, amount, unit) => {
  const d = new Date(dateObj);
  if (unit === "Months") {
    d.setMonth(d.getMonth() + amount);
  } else if (unit === "Weeks") {
    d.setDate(d.getDate() + amount * 7);
  } else if (unit === "Years") {
    d.setFullYear(d.getFullYear() + amount);
  }
  return d;
};

const addDays = (dateObj, days) => {
  const d = new Date(dateObj);
  d.setDate(d.getDate() + days);
  return d;
};

const countInstallments = (startDate, tenureEndDate, frequency) => {
  let n = 0;
  let current = new Date(startDate);
  const end = new Date(tenureEndDate);

  while (current <= end) {
    n++;
    if (frequency === "Monthly") {
      current.setMonth(current.getMonth() + 1);
    } else if (frequency === "Biweekly") {
      current = addDays(current, 14);
    } else {
      current = addDays(current, 7);
    }
  }
  return Math.max(n, 1);
};

const calculateIRR = (cashFlows, guess = 0.02) => {
  let rate = guess;
  const maxIterations = 1000;
  const tolerance = 1e-7;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      npv += cashFlows[t] / denom;
      if (t > 0) {
        dnpv -= (t * cashFlows[t]) / (denom * (1 + rate));
      }
    }
    if (Math.abs(npv) < tolerance) {
      return rate;
    }
    if (Math.abs(dnpv) < 1e-12) {
      break;
    }
    const newRate = rate - npv / dnpv;
    if (Math.abs(newRate - rate) < tolerance) {
      return newRate;
    }
    rate = newRate;
  }
  return rate;
};

// --- CALCULATE AMORTIZATION FUNCTION ---
// Note: We added 'subsidizedAmount' as the last parameter so the function can read it safely!
const calculateAmortization = (principal, annualRate, feePercentage, n, frequency, disbursementDt, startDt, subsidizedAmount = 0) => {
  const p = Number(principal);
  const rate = Number(annualRate);
  const feeRateDecimal = Number(feePercentage) / 100;
  const cfg = FREQUENCY_CONFIG[frequency];

  const r = (rate / 100) / cfg.periods_per_year;
  const dailyRate = (rate / 100) / 365;

  const diffTime = Math.abs(new Date(startDt) - new Date(disbursementDt));
  const daysStub = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const f = daysStub / cfg.period_reference_days;

  let annuityFactor = 0;
  if (n > 1) {
    annuityFactor = (1 - Math.pow(1 + r, -(n - 1))) / r;
  }

  let emi = (p * (1 + r * f)) / (1 + annuityFactor);
  emi = roundFinance(emi);

  const formatDate = (dateObj) => {
    const options = { day: '2-digit', month: 'short', year: 'numeric' };
    return new Date(dateObj).toLocaleDateString('en-GB', options).replace(/ /g, '-');
  };

  const schedule = [];

  schedule.push({
    installmentNo: 0,
    disbursementDate: formatDate(disbursementDt),
    dueDate: formatDate(disbursementDt),
    daysInPeriod: 0,
    openingBalance: 0,
    emi: -p,
    principalPaid: 0,
    interestPaid: 0,
    closingBalance: p,
  });

  let openingBalance = p;
  let currentDate = new Date(startDt);
  let previousDate = new Date(disbursementDt);

  let totalInterest = 0;

  // FIXED: Array tracking starts empty, we build customer inflows cleanly below
  const customerInflowsOnly = [];

  for (let period = 1; period <= n; period++) {
    const periodDiff = Math.abs(currentDate - previousDate);
    const daysInPeriod = Math.round(periodDiff / (1000 * 60 * 60 * 24));
    let interestPayment = roundFinance(openingBalance * dailyRate * daysInPeriod);
    totalInterest += interestPayment;

    let principalPayment, emiThisRow;
    if (period === n) {
      principalPayment = openingBalance;
      emiThisRow = openingBalance + interestPayment;
    } else {
      principalPayment = roundFinance(emi - interestPayment);
      emiThisRow = emi;
    }

    let closingBalance = roundFinance(openingBalance - principalPayment);
    customerInflowsOnly.push(emiThisRow);

    schedule.push({
      installmentNo: period,
      disbursementDate: formatDate(disbursementDt),
      dueDate: formatDate(currentDate),
      daysInPeriod: daysInPeriod,
      openingBalance: openingBalance,
      emi: emiThisRow,
      principalPaid: principalPayment,
      interestPaid: interestPayment,
      closingBalance: closingBalance,
    });

    openingBalance = closingBalance;
    previousDate = new Date(currentDate);

    if (frequency === "Monthly") {
      currentDate.setMonth(currentDate.getMonth() + 1);
    } else if (frequency === "Biweekly") {
      currentDate = addDays(currentDate, 14);
    } else {
      currentDate = addDays(currentDate, 7);
    }
  }

  // --- OPERATIONS COST, MARGIN & SUBSIDY BUSINESS IRR LOGIC ---
  const agreementValue = p + totalInterest;

  // 1. Calculate upfront fee collections dynamically from the correct parameter
  const trueFeeRateDecimal = Number(feePercentage) / 100 || 0;
  const processingFeeCollected = p * trueFeeRateDecimal;

  const businessMarginFraction = 0.25; // 25% margin profit kept by your business
  const pureMarginProfit = processingFeeCollected * businessMarginFraction;
  const subsidyInflow = Number(subsidizedAmount) || 0;

  // 2. Setup precise Day 0 Net Cash Outflows
  const netCustomerDisbursement = p - processingFeeCollected;
  const netBusinessDisbursement = p - pureMarginProfit - subsidyInflow;

  // 3. Assemble clean cash flow histories for the math formulas
  const cashFlowsCustomer = [-netCustomerDisbursement, ...customerInflowsOnly];
  const cashFlowsBusiness = [-netBusinessDisbursement, ...customerInflowsOnly];

  // 4. Calculate Customer IRR
  const periodicCustomerIRR = calculateIRR(cashFlowsCustomer, 0.02);
  const customerIRRAnnualized = Math.max(0, periodicCustomerIRR * cfg.periods_per_year * 100);

  // 5. Calculate Business IRR 
  const periodicBusinessIRR = calculateIRR(cashFlowsBusiness, 0.02);
  const businessIRRAnnualized = Math.max(0, periodicBusinessIRR * cfg.periods_per_year * 100);

  // --- RETURN STATEMENT ---
  return {
    schedule,
    computedEmi: emi,
    totalInterest,
    agreementValue,
    customerIRR: customerIRRAnnualized.toFixed(2),
    businessIRR: businessIRRAnnualized.toFixed(2)
  };
};


const pdfRupee = (amount) => {
  const sign = amount < 0 ? "-" : "";
  const absVal = Math.abs(Number(amount) || 0);
  return `Rs. ${absVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const exportRepaymentScheduleToPDF = (loanInput, scheduleResult, loanMeta = {}) => {
  const doc = new jsPDF();
  /*
  const loanId = loanMeta.loanId || '#001';   const fileName = `${loanId}_repayment schedule.pdf`; */

  // 1. Get the raw Loan Type string (default to 'Term Loan' if missing)
  const currentLoanType = loanInput.loanType || 'Term Loan';

  // 2. Generate the initials (e.g., "Term Loan" -> "TL", "OD Loan" -> "OL")
  const loanTypeInitials = currentLoanType
    .split(' ')                               // Split into individual words
    .filter(word => word.length > 0)          // Drop accidental double spaces
    .map(word => word[0].toUpperCase())       // Take the first letter of each word and uppercase it
    .join('');                                // Merge letters back together

  // 3. Extract the clean numbers from your original loanId string
  const rawId = loanMeta.loanId || '#001';
  const onlyNumbers = rawId.replace(/[^0-9]/g, ''); // Removes symbols like '#' or letters

  // 4. Combine initials and numbers to create your target format (e.g., TL001)
  // Fallback to custom prefix if no numeric data is extracted
  const generatedLoanId = onlyNumbers ? `${loanTypeInitials}${onlyNumbers}` : `${loanTypeInitials}${rawId}`;

  const fileName = `${generatedLoanId}_repayment schedule.pdf`;
  doc.setFontSize(18);
  doc.setTextColor(30, 41, 59);
  doc.text('Loan Repayment Schedule & Amortization', 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 26);

  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text('Loan Details', 14, 38);

  const loanInfoRows = [
    ['Loan ID:', generatedLoanId],
    ['Loan Type:', loanInput.loanType || 'N/A'],
    ['Borrower:', loanMeta.borrowerName || 'N/A'],
    ['Co-Borrower 1:', loanMeta.coBorrower1 || 'N/A'],
    ['Co-Borrower 2:', loanMeta.coBorrower2 || 'N/A'],
    ['Principal Amount:', pdfRupee(loanInput.principal)],
    ['Annual Interest Rate:', `${loanInput.rate}%`],
    ['Tenure:', `${loanInput.tenureValue} ${loanInput.tenureUnit}`],
    ['Payment Frequency:', loanInput.frequency],
    ['Disbursement Date:', loanInput.disbDate],
    ['First Installment Date:', loanInput.firstInstallmentDate],
    ['Loan End Date:', loanInput.loanEndDate],
    ['Total Installments:', scheduleResult.nInstallments],
    ['Calculated EMI:', pdfRupee(scheduleResult.computedEmi)],
    ['Total Interest:', pdfRupee(scheduleResult.totalInterest)],
    ['Agreement Value:', pdfRupee(scheduleResult.agreementValue)]
  ];

  autoTable(doc, {
    startY: 42,
    head: [],
    body: loanInfoRows,
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: 1.2 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55 } }
  });

  const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : 75;

  doc.setFontSize(12);
  doc.setTextColor(30, 41, 59);
  doc.text('Amortization Schedule Details', 14, finalY + 10);

  const tableColumns = ['No.', 'Disbursed', 'Due Date', 'Days', 'Opening Bal', 'EMI', 'Principal', 'Interest', 'Closing Bal'];
  const tableRows = scheduleResult.schedule.map((row) => [
    row.installmentNo,
    row.disbursementDate,
    row.dueDate,
    row.daysInPeriod,
    pdfRupee(row.openingBalance),
    pdfRupee(row.emi),
    pdfRupee(row.principalPaid),
    pdfRupee(row.interestPaid),
    pdfRupee(row.closingBalance)
  ]);

  autoTable(doc, {
    startY: finalY + 14,
    head: [tableColumns],
    body: tableRows,
    theme: 'grid',
    headStyles: { fillColor: [29, 78, 216], textColor: 255 },
    styles: { fontSize: 8, cellPadding: 3 }
  });

  doc.save(fileName);
};

const INDIA_LOCATIONS = {
  "Tamil Nadu": {
    "Ariyalur": ["Ariyalur", "Jayankondam", "Andimadam", "Sendurai"],
    "Chengalpattu": ["Chengalpattu", "Tambaram", "Pallavaram", "Maduranthakam", "Tirukalukundram", "Cheyyur", "Alandur", "Sriperumbudur"],
    "Chennai": ["Chennai City", "Alandur", "Adyar", "T. Nagar", "Velachery", "Ambattur", "Mylapore", "Egmore", "Nungambakkam", "Teynampet", "Royapuram", "Thiru-Vi-Ka-Town", "Anna Nagar", "Tondiarpet", "Perambur"],
    "Coimbatore": ["Coimbatore North", "Coimbatore South", "Pollachi", "Mettupalayam", "Sulur", "Annur", "Valparai", "Kinathukadavu", "Periyanaickenpalayam", "Madukkarai"],
    "Cuddalore": ["Cuddalore", "Chidambaram", "Virudhachalam", "Neyveli", "Panruti", "Cuddalore Taluk", "Kattumannarkoil", "Tittakudi", "Srimushnam"],
    "Dharmapuri": ["Dharmapuri", "Harur", "Palacode", "Pennagaram", "Karimangalam", "Nallampalli", "Pappireddipatti"],
    "Dindigul": ["Dindigul", "Palani", "Kodaikanal", "Oddanchatram", "Nilakkottai", "Vedasandur", "Natham", "Athoor", "Dindigul East", "Dindigul West"],
    "Erode": ["Erode", "Bhavani", "Gobichettipalayam", "Sathyamangalam", "Perundurai", "Modakurichi", "Anthiyur", "Nambiyur", "Kodumudi"],
    "Kallakurichi": ["Kallakurichi", "Tirukoilur", "Sankarapuram", "Chinnasalem", "Ulundurpet", "Kalrayan Hills"],
    "Kancheepuram": ["Kancheepuram", "Sriperumbudur", "Uthiramerur", "Kundrathur", "Walajabad"],
    "Kanyakumari": ["Nagercoil", "Kanyakumari", "Thuckalay", "Marthandam", "Padmanabhapuram", "Kulithurai", "Radhapuram", "Eraniel"],
    "Karur": ["Karur", "Kulithalai", "Krishnarayapuram", "Aravakurichi", "Pugalur", "Kadavur"],
    "Krishnagiri": ["Krishnagiri", "Hosur", "Denkanikottai", "Pochampalli", "Uthangarai", "Bargur", "Thally"],
    "Madurai": ["Madurai North", "Madurai South", "Thirumangalam", "Melur", "Usilampatti", "Vadipatti", "Thiruparankundram", "Madurai East", "Madurai West", "Peraiyur"],
    "Nagapattinam": ["Nagapattinam", "Velankanni", "Sirkazhi", "Mayiladuthurai", "Kuttalam", "Tarangambadi", "Vedaranyam"],
    "Namakkal": ["Namakkal", "Rasipuram", "Tiruchengode", "Paramathi Velur", "Komarapalayam", "Kolli Hills"],
    "Nilgiris": ["Udhagamandalam (Ooty)", "Coonoor", "Gudalur", "Kotagiri", "Kundah", "Pandalur"],
    "Perambalur": ["Perambalur", "Kunnam", "Alathur", "Veppanthattai"],
    "Pudukottai": ["Pudukottai", "Aranthangi", "Alangudi", "Illupur", "Gandarvakottai", "Ponnamaravathi", "Tirumayam", "Avurani"],
    "Ramanathapuram": ["Ramanathapuram", "Paramakudi", "Rameswaram", "Mudukulathur", "Kamuthi", "Tiruvadanai", "Kadaladi"],
    "Ranipet": ["Ranipet", "Arcot", "Walajah", "Arakkonam", "Nemili", "Sholinghur"],
    "Salem": ["Salem West", "Salem East", "Salem South", "Attur", "Mettur", "Omalur", "Edappadi", "Gangavalli", "Pethanaickenpalayam", "Yercaud", "Salem North"],
    "Sivaganga": ["Sivaganga", "Karaikudi", "Devakottai", "Tirupathur", "Manamadurai", "Ilayangudi", "Singampunari", "Kalaiyarkoil"],
    "Tenkasi": ["Tenkasi", "Sankarankovil", "Shenkottai", "Kadayanallur", "Alangulam", "Sivagiri", "V.K. Pudur"],
    "Thanjavur": ["Thanjavur", "Kumbakonam", "Pattukkottai", "Orathanadu", "Thiruvaiyaru", "Papanasam", "Thiruvidaimarudur", "Peravurani", "Kumbakonam East"],
    "Theni": ["Theni", "Periyakulam", "Bodinayakanur", "Cumbum", "Uthamapalayam", "Andipatti"],
    "Thoothukudi (Tuticorin)": ["Thoothukudi", "Kovilpatti", "Tiruchendur", "Sathankulam", "Srivaikuntam", "Ottapidaram", "Vilathikulam", "Ettayapuram"],
    "Tiruchirappalli": ["Tiruchirappalli West", "Tiruchirappalli East", "Srirangam", "Manapparai", "Thuraiyur", "Lalgudi", "Musiri", "Manachanallur", "Tiruverumbur", "Thottiyam"],
    "Tirunelveli": ["Tirunelveli", "Palayamkottai", "Ambasamudram", "Nanguneri", "Radhapuram", "Cheranmahadevi", "Manur", "Tisaiyanvilai", "Nagalapuram"],
    "Tirupathur": ["Tirupathur", "Vaniyambadi", "Ambur", "Natrampalli"],
    "Tiruppur": ["Tiruppur North", "Tiruppur South", "Avinashi", "Palladam", "Dharapuram", "Udumalaipettai", "Kangeyam", "Udumalpet", "Madathukulam"],
    "Tiruvallur": ["Tiruvallur", "Poonamallee", "Avadi", "Ponneri", "Tiruttani", "Gummidipoondi", "Uthukottai", "Pallipattu"],
    "Tiruvannamalai": ["Tiruvannamalai", "Arani", "Cheyyar", "Vandavasi", "Polur", "Chengam", "Kalasapakkam", "Tiruvethipuram"],
    "Tiruvarur": ["Tiruvarur", "Mannargudi", "Thiruthuraipoondi", "Nannilam", "Needamangalam", "Kudavasal", "Valangaiman"],
    "Vellore": ["Vellore", "Gudiyatham", "Katpadi", "Ambur", "Vaniyambadi", "Anaicut", "Pernambut"],
    "Villupuram": ["Villupuram", "Tindivanam", "Kallakurichi", "Vanur", "Gingee", "Kandamangalam", "Vikravandi", "Thiruvennainallur"],
    "Virudhunagar": ["Virudhunagar", "Sivakasi", "Aruppukottai", "Rajapalayam", "Srivilliputhur", "Sattur", "Watrap", "Kariapatti"]
  },
  "Karnataka": {
    "Bangalore Urban": ["Bangalore North", "Bangalore South", "Bangalore East", "Anekal", "Yelahanka"],
    "Mysore": ["Mysore", "Nanjangud", "Hunsur", "K.R. Nagar", "T. Narasipura"],
    "Mangalore (Dakshina Kannada)": ["Mangalore", "Bantwal", "Puttur", "Sullia", "Moodbidri"],
    "Hubli-Dharwad": ["Hubli", "Dharwad", "Kundgol", "Navalgund"]
  },
  "Maharashtra": {
    "Mumbai City": ["Colaba", "Byculla", "Dadar", "Matunga", "Parel"],
    "Mumbai Suburban": ["Andheri", "Bandra", "Borivali", "Kurla", "Malad"],
    "Pune": ["Pune City", "Haveli", "Pimpri Chinchwad", "Baramati", "Khed"],
    "Nagpur": ["Nagpur City", "Kamptee", "Umred", "Katol"]
  },
  "Delhi": {
    "New Delhi": ["Connaught Place", "Chanakyapuri", "Karol Bagh", "Pahar Ganj"],
    "North Delhi": ["Civil Lines", "Model Town", "Narela", "Timarpur"],
    "South Delhi": ["Saket", "Hauz Khas", "Mehrauli", "Greater Kailash"]
  },
  "Telangana": {
    "Hyderabad": ["Secunderabad", "Charminar", "Khairatabad", "Jubilee Hills", "Banjara Hills"],
    "Rangareddy": ["Serilingampally", "LB Nagar", "Rajendranagar", "Maheshwaram"],
    "Warangal": ["Warangal", "Hanamkonda", "Kazipet"]
  }
};

const REQUIRED_FIELD_LABELS = {
  cust_first_name: "Customer First Name",
  cust_last_name: "Customer Last Name",
  cust_email: "Email",
  cust_phone: "Phone Number",
  cust_aadhaar: "Aadhaar",
  cust_pan: "PAN",
  cust_address_line1: "Address Line 1",
  cust_state: "State",
  cust_district: "District",
  cust_city: "City",
  cust_pin_zip: "Pin/Zip Code",
};

const generateAutoLoanId = () => {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
};

// --- LOGIC HELPERS FOR REPAYMENT PAGE ---

const computeFirstInstallmentDate = (disbDateStr) => {
  if (!disbDateStr) return '';
  const [y, m, d] = disbDateStr.split('-').map(Number);
  const disbDt = new Date(y, m - 1, d);

  let targetMonth = m - 1; // 0-indexed
  let targetYear = y;

  if (d <= 25) {
    targetMonth += 1;
  } else {
    targetMonth += 2;
  }

  const targetDate = new Date(targetYear, targetMonth, 3);
  const resYear = targetDate.getFullYear();
  const resMonth = String(targetDate.getMonth() + 1).padStart(2, '0');
  const resDay = String(targetDate.getDate()).padStart(2, '0');

  return `${resYear}-${resMonth}-${resDay}`;
};

/* The logic for computing the LoanEndDate is below this code - if that code works we can delete this comment section
const computeLoanEndDateLogic = (firstInstallmentStr, tenureVal, tenureUnit) => {
  if (!firstInstallmentStr) return '';
  const [y, m, d] = firstInstallmentStr.split('-').map(Number);
  const firstDt = new Date(y, m - 1, d);
  
  let tenureInMonths = Number(tenureVal) || 0;
  if (tenureUnit === 'Years') {
    tenureInMonths = tenureInMonths * 12;
  } else if (tenureUnit === 'Weeks') {
    tenureInMonths = Math.round((tenureInMonths * 7) / 30.4375);
  }
  
  firstDt.setMonth(firstDt.getMonth() + tenureInMonths);
  
  const resYear = firstDt.getFullYear();
  const resMonth = String(firstDt.getMonth() + 1).padStart(2, '0');
  const resDay = String(firstDt.getDate()).padStart(2, '0');
  
  return `${resYear}-${resMonth}-${resDay}`;
};
*/

const computeLoanEndDateLogic = (firstInstallmentStr, tenureVal, tenureUnit) => {
  if (!firstInstallmentStr) return '';
  const [y, m, d] = firstInstallmentStr.split('-').map(Number);
  const tenureNum = Number(tenureVal) || 0;

  if (tenureUnit === 'Weeks') {
    // For weekly loans, calculate exact days elapsed between payments
    // Example: 4 weekly installments mean 3 weeks of time elapsed between 1st and Last
    const startDate = new Date(y, m - 1, d);
    const totalDaysToAdd = (tenureNum - 1) * 7;

    startDate.setDate(startDate.getDate() + totalDaysToAdd);

    const resYear = startDate.getFullYear();
    const resMonth = String(startDate.getMonth() + 1).padStart(2, '0');
    const resDay = String(startDate.getDate()).padStart(2, '0');
    return `${resYear}-${resMonth}-${resDay}`;
  }

  // Handle Monthly and Yearly tenures (treating first installment as Month 1)
  let totalMonthsToAdd = tenureUnit === 'Years' ? (tenureNum * 12) : tenureNum;

  // Subtract 1 to account for the first installment already counting as payment #1
  if (totalMonthsToAdd > 0) {
    totalMonthsToAdd = totalMonthsToAdd - 1;
  }

  // Calculate target year and month cleanly to avoid JS Date overflow bugs
  const zeroBasedStartMonth = m - 1;
  const totalZeroBasedMonths = zeroBasedStartMonth + totalMonthsToAdd;

  const resYear = y + Math.floor(totalZeroBasedMonths / 12);
  const calculatedMonth = (totalZeroBasedMonths % 12) + 1; // Convert back to 1-12 range

  // Prevent month overflow (e.g., if target month is Feb but original day is 31)
  const maxDaysInTargetMonth = new Date(resYear, calculatedMonth, 0).getDate();
  const resDay = Math.min(d, maxDaysInTargetMonth);

  const finalMonthStr = String(calculatedMonth).padStart(2, '0');
  const finalDayStr = String(resDay).padStart(2, '0');

  return `${resYear}-${finalMonthStr}-${finalDayStr}`;
};


function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authToken, setAuthToken] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captchaString, setCaptchaString] = useState('');
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');

  // Role-based page access: the list of {feature_code, can_view, can_edit,
  // can_delete} rows the backend sends back at login, based on this
  // person's role. The navigation menu below uses canView() to decide
  // which buttons to show - e.g. a Customer login will only get
  // can_view = true for LOAN_MGMT and REPAYMENT_CALC, so only those two
  // menu items appear for them.
  const [permissions, setPermissions] = useState([]);
  const canView = (featureCode) => {
    const perm = permissions.find((p) => p.feature_code === featureCode);
    return perm ? perm.can_view : false;
  };

  const [loanData, setLoanData] = useState(null);
  // Real customers loaded from the database (was hardcoded sample data before)
  const [customers, setCustomers] = useState([]);

  // Real employees loaded from the database (was hardcoded sample data before)
  const [employees, setEmployees] = useState([]);

  const [newEmployee, setNewEmployee] = useState({
    Emp_first_name: '',
    Emp_last_name: '',
    Emp_email: '',
    Emp_phone: '',
    Emp_aadhaar: '',
    Emp_pan: '',
    Emp_address_line1: '',
    Emp_address_line2: '',
    Emp_state: 'Tamil Nadu',
    Emp_district: 'Chennai',
    Emp_city: 'Chennai-South',
    Emp_pin_zip: '600018',
    Emp_country: 'India',
    Emp_designation_code: '',
    Emp_branch_code: ''
  });

  const [newCustomer, setNewCustomer] = useState({
    cust_first_name: '',
    cust_last_name: '',
    cust_email: '',
    cust_phone: '',
    cust_aadhaar: '',
    cust_pan: '',
    cust_address_line1: '',
    cust_address_line2: '',
    cust_state: 'Tamil Nadu',
    cust_district: '',
    cust_city: '',
    cust_pin_zip: '',
    cust_country: 'India'
  });
  const [availableDistricts, setAvailableDistricts] = useState([]);
  const [availableCities, setAvailableCities] = useState([]);

  const [customerValidationErrors, setCustomerValidationErrors] = useState({});
  const [customerTopError, setCustomerTopError] = useState('');
  const [nextCustomerId, setNextCustomerId] = useState('202609002');

  const [editId, setEditId] = useState(null);
  const [editingCustomerIdValue, setEditingCustomerIdValue] = useState('');
  const [selectedCloseId, setSelectedCloseId] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const [newLoanForm, setNewLoanForm] = useState({
    loanId: generateAutoLoanId(),
    borrowerSearch: '',
    selectedBorrower: '',
    coBorrower1Search: '',
    coBorrower1: '',
    coBorrower2Search: '',
    coBorrower2: '',
    principal: 500000,
    rate: 15.0,
    feePercentage: 0.0,
    tenureValue: 24,
    tenureUnit: 'Months',
    frequency: 'Monthly',
    disbDate: '2026-06-10',
    firstInstallmentDate: '2026-07-03',
    loanEndDate: '2028-07-03',
  });
  const [reviewScheduleData, setReviewScheduleData] = useState(null);

  // Initial setup for Repayment Calculation Page
  const initialDisbDate = '2026-06-10';
  const initialFirstInst = computeFirstInstallmentDate(initialDisbDate);
  const initialLoanEnd = computeLoanEndDateLogic(initialFirstInst, 24, 'Months');
  const initialPrincipal = 750000;
  const initialfeePercentage = 0;
  const initialSubsidizedAmt = 0;
  const initialSubPercent = initialPrincipal ? ((initialSubsidizedAmt / initialPrincipal) * 100).toFixed(2) : '0';

  const [loanInput, setLoanInput] = useState({
    principal: initialPrincipal,
    rate: 28.0,
    subsidizedAmount: initialSubsidizedAmt,
    subsidizedPercent: initialSubPercent,
    feePercentage: initialfeePercentage,
    tenureValue: 24,
    tenureUnit: 'Months',
    frequency: 'Monthly',
    disbDate: initialDisbDate,
    firstInstallmentDate: initialFirstInst,
    loanEndDate: initialLoanEnd,
  });
  const [scheduleResult, setScheduleResult] = useState(null);

  useEffect(() => {
    generateNewCaptcha();
  }, []);

  useEffect(() => {
    if (newCustomer.cust_state && INDIA_LOCATIONS[newCustomer.cust_state]) {
      const districts = Object.keys(INDIA_LOCATIONS[newCustomer.cust_state]);
      setAvailableDistricts(districts);
      if (!districts.includes(newCustomer.cust_district)) {
        setNewCustomer(prev => ({ ...prev, cust_district: '', cust_city: '' }));
        setAvailableCities([]);
      }
    } else {
      setAvailableDistricts([]);
      setAvailableCities([]);
    }
  }, [newCustomer.cust_state]);

  useEffect(() => {
    if (newCustomer.cust_state && newCustomer.cust_district && INDIA_LOCATIONS[newCustomer.cust_state]?.[newCustomer.cust_district]) {
      const cities = INDIA_LOCATIONS[newCustomer.cust_state][newCustomer.cust_district];
      setAvailableCities(cities);
      if (!cities.includes(newCustomer.cust_city)) {
        setNewCustomer(prev => ({ ...prev, cust_city: '' }));
      }
    } else {
      setAvailableCities([]);
    }
  }, [newCustomer.cust_district]);

  // 1. Update districts when Employee State changes
useEffect(() => {
  if (newEmployee?.Emp_state && INDIA_LOCATIONS[newEmployee.Emp_state]) {
    const districts = Object.keys(INDIA_LOCATIONS[newEmployee.Emp_state]);
    setAvailableDistricts(districts);
    
    // Reset district & city if current selection isn't in the new state's districts
    if (!districts.includes(newEmployee.Emp_district)) {
      setNewEmployee(prev => ({ ...prev, Emp_district: '', Emp_city: '' }));
      setAvailableCities([]);
    }
  } else {
    setAvailableDistricts([]);
    setAvailableCities([]);
  }
}, [newEmployee?.Emp_state]);

// 2. Update cities when Employee District changes
useEffect(() => {
  const currentState = newEmployee?.Emp_state;
  const currentDistrict = newEmployee?.Emp_district;

  if (currentState && currentDistrict && INDIA_LOCATIONS[currentState]?.[currentDistrict]) {
    const cities = INDIA_LOCATIONS[currentState][currentDistrict];
    setAvailableCities(cities);
    
    // Reset city if current selection isn't in the new district's cities
    if (!cities.includes(newEmployee.Emp_city)) {
      setNewEmployee(prev => ({ ...prev, Emp_city: '' }));
    }
  } else {
    setAvailableCities([]);
  }
}, [newEmployee?.Emp_district]);

  const generateNewCaptcha = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let result = "";
    for (let i = 0; i < 5; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCaptchaString(result);
    setCaptchaAnswer('');
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    if (captchaAnswer.trim() !== captchaString) {
      setError('Incorrect CAPTCHA text. Please try the new code.');
      generateNewCaptcha();
      return;
    }

    try {
      const data = await loginUser(username, password);
      if (data.success) {
        setAuthToken(data.token);
        setIsLoggedIn(true);
        // Store this person's role-based permissions so the menu below
        // knows exactly which pages to show them.
        setPermissions(data.permissions || []);
        fetchLoanDataLocally();
        loadCustomersAndEmployees(data.token);
      } else {
        setError(data.message || 'Invalid email or password.');
        generateNewCaptcha();
        setPassword('');
      }
    } catch (err) {
      console.error('Login request failed:', err);
      setError('Could not reach the server. Check that your backend is running on port 8000.');
      generateNewCaptcha();
    }
  };

  const fetchLoanDataLocally = () => {
    setLoanData({
      totalLoan: 39500,
      amountPaid: 14200,
      remainingBalance: 25300,
      nextDueDate: "2026-10-15",
      leadsGenerated: 50,
      leadsContacted: 35,
      leadsConverted: 10,
      loansInitiated: 28,
      loansSanctioned: 10,
      loansDisbursed: 11,
      location: "Tamil Nadu",
      SanctionedAmount: 200000000,
      DisbursedAmount: 444000000,
      CurrentMonthAchieved: 78000000,
      InitiatedAmount: 900000000
    });
  };

  // Loads the real customer and employee lists from the database after login
  const loadCustomersAndEmployees = async (token) => {
    try {
      const custRes = await getCustomers(token);
      if (custRes.success) {
        const mapped = (custRes.data || []).map((c) => ({
          cust_pk: c.cust_pk,
          cust_id: c.cust_id,
          first_name: c.cust__fname || c.cust_fname,
          last_name: c.cust_lname,
          email: c.cust_email,
          phone: c.cust_phone,
          address_line1: c.cust_addressline1,
          address_line2: c.cust_addressline2,
          city: c.cust_city,
          district: c.cust_district || '',
          state: c.cust_state,
          pin_zip: c.cust_pinzip,
          country: c.cust_country,
          pan: c.cust_pan || 'N/A',
          aadhaar: c.cust_aadhar || 'N/A',
          loanAmount: 'N/A',
          status: 'Active'
        }));
        setCustomers(mapped);
        const custNums = mapped.map((c) => Number(c.cust_id)).filter((n) => !isNaN(n));
        if (custNums.length) {
          setNextCustomerId(String(Math.max(...custNums) + 1));
        }
      }
    } catch (err) {
      console.error('Failed to load customers:', err);
    }

    try {
      const empRes = await getEmployees(token);
      if (empRes.success) {
        const mappedEmp = (empRes.data || []).map((e) => ({
          emp_pk: e.emp_pk,
          emp_id: e.emp_id,
          first_name: e.emp_fname,
          last_name: e.emp_lname,
          email: e.emp_email,
          phone: e.emp_phone,
          address_line1: e.emp_addressline1,
          address_line2: e.emp_addressline2,
          city: e.emp_city,
          district: e.emp_district || '',
          state: e.emp_state,
          pin_zip: e.emp_pinzip,
          country: e.emp_country,
          pan: e.emp_pan || 'N/A',
          aadhar: e.emp_aadhar || 'N/A',
          status: e.emp_status === false ? 'Inactive' : 'Active'
        }));
        setEmployees(mappedEmp);
        setNextEmployeeId(computeNextEmployeeId(mappedEmp));
      }
    } catch (err) {
      console.error('Failed to load employees:', err);
    }
  };

  const computeNextEmployeeId = (employeeList) => {
    const nums = (employeeList || [])
      .map((e) => {
        const m = e.emp_id && String(e.emp_id).match(/^EMP(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      })
      .filter((n) => !isNaN(n));
    const maxNum = nums.length ? Math.max(...nums) : 0;
    return `EMP${String(maxNum + 1).padStart(3, '0')}`;
  };

  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    setCustomerTopError('');

    let newErrors = {};
    for (const [key, label] of Object.entries(REQUIRED_FIELD_LABELS)) {
      if (!newCustomer[key] || !String(newCustomer[key]).trim()) {
        newErrors[key] = `${label} is required.`;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setCustomerValidationErrors(newErrors);
      setCustomerTopError('Please fix the highlighted field(s) below before continuing.');
      return;
    }

    setCustomerValidationErrors({});

    const displayPayload = {
      first_name: newCustomer.cust_first_name.trim(),
      last_name: newCustomer.cust_last_name.trim(),
      email: newCustomer.cust_email.trim(),
      phone: newCustomer.cust_phone.trim(),
      pan: newCustomer.cust_pan.trim(),
      address_line1: newCustomer.cust_address_line1.trim(),
      address_line2: newCustomer.cust_address_line2.trim(),
      state: newCustomer.cust_state,
      district: newCustomer.cust_district,
      city: newCustomer.cust_city,
      pin_zip: newCustomer.cust_pin_zip.trim(),
      country: newCustomer.cust_country || 'India',
      loanAmount: '₹500,000'
    };

    if (editId !== null) {
      // NOTE: editing an existing customer is not connected to the real database yet -
      // this still only updates it on this screen, not in the database.
      setCustomers(customers.map(c => c.cust_pk === editId ? { ...c, ...displayPayload } : c));
      setSuccessMessage('Customer updated successfully.');
      setEditId(null);
      clearCustomerForm();
      setActiveTab('dashboard');
      setTimeout(() => setSuccessMessage(''), 4000);
      return;
    }

    // Creating a new customer: send it to the real backend
    const apiPayload = {
      cust_fname: newCustomer.cust_first_name.trim(),
      cust_lname: newCustomer.cust_last_name.trim(),
      cust_email: newCustomer.cust_email.trim(),
      cust_phone: newCustomer.cust_phone.trim(),
      cust_aadhar: newCustomer.cust_aadhaar.trim(),
      cust_pan: newCustomer.cust_pan.trim(),
      cust_addressline1: newCustomer.cust_address_line1.trim(),
      cust_addressline2: newCustomer.cust_address_line2.trim(),
      cust_city: newCustomer.cust_city,
      cust_state: newCustomer.cust_state,
      cust_pinzip: newCustomer.cust_pin_zip.trim(),
      cust_country: newCustomer.cust_country || 'India'
    };

    try {
      const result = await createCustomer(apiPayload, authToken);
      if (result.success) {
        setSuccessMessage(`Customer registered successfully! Customer ID: ${result.data.cust_id}`);
        await loadCustomersAndEmployees(authToken);
        // Wait 2 seconds before moving to the dashboard, so the success
        // message is actually visible next to the Register button first,
        // instead of switching pages instantly and hiding it off-screen.
        setTimeout(() => {
          clearCustomerForm();
          setActiveTab('dashboard');
        }, 2000);
      } else {
        setCustomerTopError(result.message || 'Could not save this customer. Please try again.');
      }
    } catch (err) {
      console.error('Failed to save customer:', err);
      setCustomerTopError('Could not reach the server. Check that your backend is running on port 8000.');
    }

    // Message stays up for 8 seconds total (2s on this form + 6s after
    // landing on the dashboard) so there's actually enough time to read it,
    // instead of it vanishing right after the page switch.
    setTimeout(() => setSuccessMessage(''), 8000);
  };

  const clearCustomerForm = () => {
    setNewCustomer({
      cust_first_name: '',
      cust_last_name: '',
      cust_email: '',
      cust_phone: '',
      cust_aadhaar: '',
      cust_pan: '',
      cust_address_line1: '',
      cust_address_line2: '',
      cust_state: 'Tamil Nadu',
      cust_district: '',
      cust_city: '',
      cust_pin_zip: '',
      cust_country: 'India'
    });
    setCustomerValidationErrors({});
    setCustomerTopError('');
    setEditId(null);
  };

  const handleEditClick = (customer) => {
    setNewCustomer({
      cust_first_name: customer.first_name || '',
      cust_last_name: customer.last_name || '',
      cust_email: customer.email || '',
      cust_phone: customer.phone || '',
      cust_aadhaar: customer.aadhaar || '',
      cust_pan: customer.pan || '',
      cust_address_line1: customer.address_line1 || '',
      cust_address_line2: customer.address_line2 || '',
      cust_state: customer.state || 'Tamil Nadu',
      cust_district: customer.district || '',
      cust_city: customer.city || '',
      cust_pin_zip: customer.pin_zip || '',
      cust_country: customer.country || 'India'
    });
    setEditId(customer.cust_pk);
    setEditingCustomerIdValue(customer.cust_id || '');
    setActiveTab('addCustomer');
  };

  const handleAddNewTabClick = () => {
    clearCustomerForm();
    setActiveTab('addCustomer');
  };

  const clearEmployeeForm = () => {
    setNewEmployee({
      Emp_first_name: '',
      Emp_last_name: '',
      Emp_email: '',
      Emp_phone: '',
      Emp_aadhaar: '',
      Emp_pan: '',
      Emp_address_line1: '',
      Emp_address_line2: '',
      Emp_state: 'Tamil Nadu',
      Emp_district: '',
      Emp_city: '',
      Emp_pin_zip: '',
      Emp_country: 'India',
      Emp_designation_code: '',
      Emp_branch_code: ''
    });
    setEmployeeValidationErrors({});
    setEmployeeTopError('');
  };

  const [EmployeeValidationErrors, setEmployeeValidationErrors] = useState({});
  const [EmployeeTopError, setEmployeeTopError] = useState('');
  const [nextEmployeeId, setNextEmployeeId] = useState('EMP003');
  const [editingEmployeeIdValue, setEditingEmployeeIdValue] = useState('');

  const handleAddNewEmployeeClick = () => {
    clearEmployeeForm();
    setActiveTab('addEmployee');
    setSuccessMessage('');
  };

  const handleAddNewLoanClick = () => {
    setNewLoanForm({
      loanId: generateAutoLoanId(),
      borrowerSearch: '',
      selectedBorrower: '',
      coBorrower1Search: '',
      coBorrower1: '',
      coBorrower2Search: '',
      coBorrower2: '',
      principal: 750000,
      rate: 28.0,
      feePercentage: 2.0,
      tenureValue: 24,
      tenureUnit: 'Months',
      frequency: 'Monthly',
      disbDate: '2026-06-10',
      firstInstallmentDate: '2026-07-03',
      loanEndDate: '2028-07-03',
    });
    setActiveTab('addNewLoan');
  };

  // --- ADD/EDIT/DELETE EMPLOYEE HANDLERS ---
  const [editEmployeeId, setEditEmployeeId] = useState(null);

  const handleSaveEmployee = async (e) => {
    e.preventDefault();
    setEmployeeTopError('');

    const requiredEmpFields = {
      Emp_first_name: 'First Name',
      Emp_last_name: 'Last Name',
      Emp_email: 'Email',
      Emp_phone: 'Phone',
      Emp_aadhaar: 'Aadhaar',
      Emp_pan: 'PAN',
      Emp_address_line1: 'Address Line 1',
      Emp_state: 'State',
      Emp_district: 'District',
      Emp_city: 'City',
      Emp_pin_zip: 'Pincode',
      Emp_designation_code: 'Designation Code'
    };

    let newErrors = {};
    for (const [key, label] of Object.entries(requiredEmpFields)) {
      if (!newEmployee[key] || !String(newEmployee[key]).trim()) {
        newErrors[key] = `${label} is required.`;
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setEmployeeValidationErrors(newErrors);
      setEmployeeTopError('Please fix the highlighted field(s) below before continuing.');
      return;
    }

    setEmployeeValidationErrors({});

    const displayPayload = {
      first_name: newEmployee.Emp_first_name.trim(),
      last_name: newEmployee.Emp_last_name.trim(),
      email: newEmployee.Emp_email.trim(),
      phone: newEmployee.Emp_phone.trim(),
      pan: newEmployee.Emp_pan.trim(),
      address_line1: newEmployee.Emp_address_line1.trim(),
      address_line2: newEmployee.Emp_address_line2.trim(),
      state: newEmployee.Emp_state,
      district: newEmployee.Emp_district,
      city: newEmployee.Emp_city,
      pin_zip: newEmployee.Emp_pin_zip.trim(),
      country: newEmployee.Emp_country || 'India',
      role: 'Loan Officer'
    };

    if (editEmployeeId !== null) {
      // NOTE: editing an existing employee is not connected to the real database yet -
      // this still only updates it on this screen, not in the database.
      setEmployees(employees.map(emp => (emp.emp_pk || emp.emp_id) === editEmployeeId ? { ...emp, ...displayPayload } : emp));
      setSuccessMessage('Employee updated successfully.');
      setEditEmployeeId(null);
      clearEmployeeForm();
      setActiveTab('employeeRecords');
      setTimeout(() => setSuccessMessage(''), 4000);
      return;
    }

    // Creating a new employee: send it to the real backend
    const apiPayload = {
      emp_id: nextEmployeeId,
      emp_fname: newEmployee.Emp_first_name.trim(),
      emp_lname: newEmployee.Emp_last_name.trim(),
      emp_email: newEmployee.Emp_email.trim(),
      emp_phone: newEmployee.Emp_phone.trim(),
      emp_branch_code: newEmployee.Emp_branch_code || null,
      emp_addressline1: newEmployee.Emp_address_line1.trim(),
      emp_city: newEmployee.Emp_city,
      emp_state: newEmployee.Emp_state,
      emp_pinzip: newEmployee.Emp_pin_zip.trim(),
      emp_aadhar: newEmployee.Emp_aadhaar.trim(),
      emp_pan: newEmployee.Emp_pan.trim(),
      emp_joindt: new Date().toISOString().slice(0, 10),
      emp_status: true,
      emp_designation_code: newEmployee.Emp_designation_code.trim(),
      emp_reporting_manager_id: null,
      // emp_createdby must be a real Employee ID (EMP024, etc.) because the
      // database checks it against the employee table - sending the logged-in
      // user's email here caused every save to fail with a server error.
      // Leaving it blank for now until we look up the logged-in employee's real ID.
      emp_createdby: null
    };

    try {
      const result = await createEmployee(apiPayload, authToken);
      if (result.success) {
        setSuccessMessage(`Employee registered successfully! Employee ID: ${result.data.emp_id}`);
        await loadCustomersAndEmployees(authToken);
        // Wait 2 seconds before moving to the records page, so the success
        // message is actually visible next to the Register button first,
        // instead of switching pages instantly and hiding it off-screen.
        setTimeout(() => {
          clearEmployeeForm();
          setActiveTab('employeeRecords');
        }, 2000);
      } else {
        setEmployeeTopError(result.message || 'Could not register this employee. Please try again.');
        // Refresh the suggested Employee ID after a failed save too - otherwise
        // it keeps retrying with the same (possibly now-taken) ID every time,
        // e.g. if someone else just registered an employee with that same ID.
        await loadCustomersAndEmployees(authToken);
      }
    } catch (err) {
      console.error('Failed to save employee:', err);
      setEmployeeTopError('Could not reach the server. Check that your backend is running on port 8000.');
    }

    // Message stays up for 8 seconds total (2s on this form + 6s after
    // landing on the Employee Records page) so there's actually enough
    // time to read it, instead of it vanishing right after the page switch.
    setTimeout(() => setSuccessMessage(''), 8000);
  };

  const handleEditEmployee = (emp) => {
    setNewEmployee({
      Emp_first_name: emp.first_name || '',
      Emp_last_name: emp.last_name || '',
      Emp_email: emp.email || '',
      Emp_phone: emp.phone || '',
      Emp_aadhaar: emp.aadhaar || '',
      Emp_pan: emp.pan || '',
      Emp_address_line1: emp.address_line1 || '',
      Emp_address_line2: emp.address_line2 || '',
      Emp_state: emp.state || 'Tamil Nadu',
      Emp_district: emp.district || '',
      Emp_city: emp.city || '',
      Emp_pin_zip: emp.pin_zip || '',
      Emp_country: emp.country || 'India'
    });
    setEditEmployeeId(emp.emp_pk || emp.emp_id);
    setActiveTab('addEmployee');
  };

  const handleDeleteEmployee = (empPk) => {
    if (!window.confirm('Are you sure you want to mark this employee as inactive?')) return;
    setEmployees(employees.map(emp => (emp.emp_pk || emp.emp_id) === empPk ? { ...emp, status: 'Inactive' } : emp));
    setSuccessMessage('Employee marked as inactive.');
    setTimeout(() => setSuccessMessage(''), 4000);
  };

  const handleDeleteCustomer = (custPk) => {
    if (!window.confirm('Are you sure you want to mark this customer as inactive/deleted?')) return;
    setCustomers(customers.map(c => c.cust_pk === custPk ? { ...c, status: 'Closed' } : c));
    setSuccessMessage('Customer marked inactive.');
    setTimeout(() => setSuccessMessage(''), 4000);
  };

  const handleMarkAsClosed = (e) => {
    e.preventDefault();
    if (!selectedCloseId) return;

    setCustomers(customers.map(c => c.cust_pk === Number(selectedCloseId) ? { ...c, status: 'Closed' } : c));
    setSuccessMessage(`Application #${selectedCloseId} has been successfully marked as closed.`);
    setSelectedCloseId('');
    setTimeout(() => setSuccessMessage(''), 4000);
  };

  // --- REPAYMENT CALCULATION PAGE HANDLERS ---

  const handleDisbursementDateChange = (e) => {
    const newDisbDate = e.target.value;
    if (!newDisbDate) {
      setLoanInput({ ...loanInput, disbDate: '', firstInstallmentDate: '', loanEndDate: '' });
      return;
    }
    const derivedFirstInstallment = computeFirstInstallmentDate(newDisbDate);
    const derivedLoanEndDate = computeLoanEndDateLogic(derivedFirstInstallment, loanInput.tenureValue, loanInput.tenureUnit);

    setLoanInput({
      ...loanInput,
      disbDate: newDisbDate,
      firstInstallmentDate: derivedFirstInstallment,
      loanEndDate: derivedLoanEndDate,
    });
  };

  const handleTenureChange = (newVal, newUnit) => {
    const val = newVal !== undefined ? newVal : loanInput.tenureValue;
    const unit = newUnit !== undefined ? newUnit : loanInput.tenureUnit;
    const derivedLoanEndDate = computeLoanEndDateLogic(loanInput.firstInstallmentDate, val, unit);

    setLoanInput({
      ...loanInput,
      tenureValue: val,
      tenureUnit: unit,
      loanEndDate: derivedLoanEndDate,
    });
  };

  const handlePrincipalChange = (newPrincipal) => {
    const p = Number(newPrincipal) || 0;
    const subAmt = Number(loanInput.subsidizedAmount) || 0;
    const subPct = p > 0 ? ((subAmt / p) * 100).toFixed(2) : '0';

    setLoanInput({
      ...loanInput,
      principal: newPrincipal,
      subsidizedPercent: subPct,
    });
  };

  const handleSubsidizedAmountChange = (newAmt) => {
    const amt = Number(newAmt) || 0;
    const p = Number(loanInput.principal) || 0;
    const subPct = p > 0 ? ((amt / p) * 100).toFixed(2) : '0';

    setLoanInput({
      ...loanInput,
      subsidizedAmount: newAmt,
      subsidizedPercent: subPct,
    });
  };

  const handleNewLoanDisbDateChange = (e) => {
    const newDisbDate = e.target.value;
    if (!newDisbDate) {
      setNewLoanForm({ ...newLoanForm, disbDate: '', firstInstallmentDate: '', loanEndDate: '' });
      return;
    }
    const derivedFirstInstallment = computeFirstInstallmentDate(newDisbDate);
    const derivedLoanEndDate = computeLoanEndDateLogic(derivedFirstInstallment, newLoanForm.tenureValue, newLoanForm.tenureUnit);

    setNewLoanForm({
      ...newLoanForm,
      disbDate: newDisbDate,
      firstInstallmentDate: derivedFirstInstallment,
      loanEndDate: derivedLoanEndDate,
    });
  };

  const handleGenerateSchedule = (e) => {
    e.preventDefault();
    const disbDt = new Date(loanInput.disbDate);
    const startDt = new Date(loanInput.firstInstallmentDate);
    const endDt = new Date(loanInput.loanEndDate);
    const nInstallments = countInstallments(startDt, endDt, loanInput.frequency);

    // FIXED: Mapped feePercentage to the 3rd slot and subsidizedAmount to the 8th slot
    const amortizationRes = calculateAmortization(
      loanInput.principal,
      loanInput.rate,
      loanInput.feePercentage || 0, // <-- Changed from loanInput.subsidizedPercent
      nInstallments,
      loanInput.frequency,
      disbDt,
      startDt,
      loanInput.subsidizedAmount || 0 // <-- Added at the very end
    );

    const options = { day: '2-digit', month: 'short', year: 'numeric' };
    const firstInstallmentDateStr = new Date(startDt).toLocaleDateString('en-GB', options).replace(/ /g, '-');
    const actualEndDt = amortizationRes.schedule[amortizationRes.schedule.length - 1].dueDate;

    setScheduleResult({
      ...amortizationRes,
      nInstallments,
      firstInstallmentDate: firstInstallmentDateStr,
      loanEndDate: actualEndDt,
      actualEndDt,
    });
  };

  const handleNewLoanNext = (e) => {
    e.preventDefault();
    if (!newLoanForm.selectedBorrower) {
      alert('Please select a Borrower from the dropdown.');
      return;
    }
    const disbDt = new Date(newLoanForm.disbDate);
    const startDt = new Date(newLoanForm.firstInstallmentDate);
    const endDt = new Date(newLoanForm.loanEndDate);
    const nInstallments = countInstallments(startDt, endDt, newLoanForm.frequency);

    const amortizationRes = calculateAmortization(
      newLoanForm.principal,
      newLoanForm.rate,
      newLoanForm.feePercentage,
      nInstallments,
      newLoanForm.frequency,
      disbDt,
      startDt
    );

    const options = { day: '2-digit', month: 'short', year: 'numeric' };
    const firstInstallmentDateStr = new Date(startDt).toLocaleDateString('en-GB', options).replace(/ /g, '-');
    const actualEndDt = amortizationRes.schedule[amortizationRes.schedule.length - 1].dueDate;

    setReviewScheduleData({
      ...amortizationRes,
      nInstallments,
      firstInstallmentDate: firstInstallmentDateStr,
      loanEndDate: actualEndDt,
      actualEndDt,
    });
    setActiveTab('reviewRepaymentSchedule');
  };

  const handleReviewSubmitAndDownloadPDF = () => {
    const selectedCustObj = customers.find(c => String(c.cust_pk) === String(newLoanForm.selectedBorrower));
    const borrowerName = selectedCustObj ? `${selectedCustObj.first_name} ${selectedCustObj.last_name}` : 'Unknown Borrower';
    const co1Obj = customers.find(c => String(c.cust_pk) === String(newLoanForm.coBorrower1));
    const coBorrower1Name = co1Obj ? `${co1Obj.first_name} ${co1Obj.last_name}` : 'None';
    const co2Obj = customers.find(c => String(c.cust_pk) === String(newLoanForm.coBorrower2));
    const coBorrower2Name = co2Obj ? `${co2Obj.first_name} ${co2Obj.last_name}` : 'None';

    const loanMeta = {
      loanId: newLoanForm.loanId,
      borrowerName,
      coBorrower1: coBorrower1Name,
      coBorrower2: coBorrower2Name
    };
    exportRepaymentScheduleToPDF(newLoanForm, reviewScheduleData, loanMeta);

    setSuccessMessage(`Loan #${newLoanForm.loanId} submitted and PDF generated successfully.`);
    setActiveTab('loanRecords');
    setTimeout(() => setSuccessMessage(''), 4000);
  };

  return (
    <>
      <style>
        {`
          @keyframes lightGradientAnimation {
            0% { background-position: 0% 50%; }
            50% { background-position: 100% 50%; }
            100% { background-position: 0% 50%; }
          }
          .animated-login-bg {
            background: linear-gradient(-45deg, #f0fdf4, #e0f2fe, #fdf4ff, #f8fafc);
            background-size: 400% 400%;
            animation: lightGradientAnimation 12s ease infinite;
          }
        `}
      </style>
      <div style={styles.pageContainer} className={!isLoggedIn ? "animated-login-bg" : ""}>
        {!isLoggedIn ? (
          <div style={styles.loginSplitCard}>
            <div style={styles.loginBrandSection}>
              <img src={iLendQLogo} alt="iLendQ Logo" style={styles.logoImageLeft} />
              <h1 style={styles.loginHeroTitle}>Loan Management Portal</h1>
              <p style={styles.loginHeroSubtitle}>Simple, smart, and scalable AI-driven workflows accelerating corporate lending securely.</p>
            </div>

            <div style={styles.loginFormSection}>
              <div style={styles.headerSection}>
                <h2 style={styles.title}>Welcome Back</h2>
                <p style={styles.subtitle}>Please sign in to your dashboard</p>
              </div>

              <form onSubmit={handleLogin} style={styles.form}>
                <div style={styles.inputGroup}>
                  <label style={styles.label}>Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    style={styles.input}
                    required
                  />
                </div>

                <div style={styles.inputGroup}>
                  <label style={styles.label}>Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={styles.input}
                    required
                  />
                </div>

                <div style={styles.inputGroup}>
                  <label style={styles.label}>Security Verification (Type the letters below)</label>
                  <div style={styles.captchaContainer}>
                    <div style={styles.captchaVisual}>
                      <span style={styles.captchaTextDisplay}>{captchaString}</span>
                      <button
                        type="button"
                        onClick={generateNewCaptcha}
                        style={styles.refreshBtn}>
                        🔄 Reload Code
                      </button>
                    </div>
                    <input
                      type="text"
                      value={captchaAnswer}
                      onChange={(e) => setCaptchaAnswer(e.target.value)}
                      placeholder="Enter characters exactly"
                      style={styles.input}
                      autoComplete="off"
                      required
                    />
                  </div>
                </div>

                {error && <div style={styles.errorBanner}>{error}</div>}

                <button type="submit" style={styles.primaryButton}>
                  Sign In
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div style={styles.appLayout}>
            <div style={styles.sidebar}>
              <div style={styles.sidebarBrand}>
                <span style={{ ...styles.sidebarRole}}>Navigation Menu</span>
              </div>
              <div style={styles.navLinks}>

                {/* Each menu item below only renders if this person's role
                    has can_view = true for that feature - see canView()
                    above. A Customer login, for example, will only see
                    Loan Management and Repayment Calculation. */}

                {/* Dashboard */}
                {canView('DASHBOARD') && (
                  <button
                    onClick={() => setActiveTab('dashboard')}
                    style={{ ...styles.navItem, color: '#374151', ...(activeTab === 'dashboard' ? styles.activeNavItem : {}) }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '10px' }}>
                      <rect x="3" y="3" width="7" height="7"></rect>
                      <rect x="14" y="3" width="7" height="7"></rect>
                      <rect x="14" y="14" width="7" height="7"></rect>
                      <rect x="3" y="14" width="7" height="7"></rect>
                    </svg>
                    Dashboard
                  </button>
                )}

                {/* Employee Management */}
                {canView('EMPLOYEE_MGMT') && (
                  <button
                    onClick={() => setActiveTab('employeeRecords')}
                    style={{ ...styles.navItem, color: '#374151', ...(activeTab === 'employeeRecords' || activeTab === 'addEmployee' ? styles.activeNavItem : {}) }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '10px' }}>
                      {/* ID Badge Outer Frame */}
                      <rect x="3" y="4" width="18" height="16" rx="2"></rect>
                      {/* Photo Head */}
                      <circle cx="12" cy="10" r="3"></circle>
                      {/* Photo Shoulders */}
                      <path d="M7 17c0-2 2.5-3 5-3s5 1 5 3"></path>
                      {/* Lanyard Clip Line */}
                      <line x1="12" y1="2" x2="12" y2="4"></line>
                    </svg>
                    Employee Management
                  </button>
                )}

                {/* Customer Management */}
                {canView('CUSTOMER_MGMT') && (
                  <button
                    onClick={() => setActiveTab('customerRecords')}
                    style={{ ...styles.navItem, color: '#374151', ...(activeTab === 'customerRecords' || activeTab === 'addCustomer' ? styles.activeNavItem : {}) }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '10px' }}>
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    Customer Management
                  </button>
                )}

                {/* Loan Management */}
                {canView('LOAN_MGMT') && (
                  <button
                    onClick={() => setActiveTab('loanRecords')}
                    style={{ ...styles.navItem, color: '#374151', ...(activeTab === 'loanRecords' || activeTab === 'addNewLoan' || activeTab === 'reviewRepaymentSchedule' ? styles.activeNavItem : {}) }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '10px' }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                      <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    Loan Management
                  </button>
                )}

                {/* Repayment Calculation */}
                {canView('REPAYMENT_CALC') && (
                  <button
                    onClick={() => setActiveTab('repaymentSchedule')}
                    style={{ ...styles.navItem, color: '#374151', ...(activeTab === 'repaymentSchedule' ? styles.activeNavItem : {}) }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '10px' }}>
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                      <line x1="16" y1="2" x2="16" y2="6"></line>
                      <line x1="8" y1="2" x2="8" y2="6"></line>
                      <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    Repayment Calculation
                  </button>
                )}
              </div>

              <div style={styles.sidebarFooter}>
                <button
                  onClick={() => { setIsLoggedIn(false); generateNewCaptcha(); }}
                  style={styles.logoutButton}>
                  Sign Out
                </button>
              </div>
            </div>

            <div style={styles.mainContent}>
              <header style={styles.topNavbar}>
                <div style={styles.navbarLeftGroup}>
                  <img src={iLendQLogo} alt="iLendQ Logo" style={styles.logoImageNavbar} />
                  <h2 style={styles.pageHeading}>
                    {activeTab === 'dashboard' && 'Welcome to Dashboard'}
                    {activeTab === 'Customer Management' && (editId !== null ? 'Edit Customer' : 'Customer Onboarding Form')}
                    {activeTab === 'repaymentSchedule' && 'Repayment Schedule & Amortization'}
                    {activeTab === 'loanRecords' && 'Loan Dashboard & Records Management'}
                    {activeTab === 'addNewLoan' && 'Add New Loan'}
                    {activeTab === 'reviewRepaymentSchedule' && 'Review Repayment Schedule'}
                  </h2>
                </div>
                <div style={styles.userProfileBadge}>
                  <span>Welcome Customer, <strong>{username}</strong></span>
                </div>
              </header>

<div style={styles.contentBody}>
  {activeTab === 'dashboard' && (
    <div>
      <p style={styles.welcomeSubtext}>
        Here is the real-time summary and loan records overview of your portfolio.
      </p>
      
      {successMessage && <div style={styles.successBanner}>{successMessage}</div>}

      {loanData && (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

            {/* 1. NEW: TARGET VS. ACHIEVEMENT TRACKER CARD */}
            <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <div>
                  <h3 style={{ fontSize: '15px', color: '#1e293b', fontWeight: '700', margin: 0 }}>
                    Target vs. Achievement Tracker
                  </h3>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0' }}>
                    Performance metrics for current month & annual trajectory
                  </p>
                </div>
                <span style={{ fontSize: '11px', background: '#f0fdf4', color: '#16a34a', fontWeight: '700', padding: '4px 10px', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                  ● On Track for Q3
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>

                {/* Current Month Target (Donut Chart) */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#334155' }}>Current Month Target</span>
                    <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '600' }}>September 2026</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '16px 0', position: 'relative' }}>
                    <svg width="140" height="140" viewBox="0 0 36 36" style={{ transform: 'rotate(-90deg)' }}>
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth="3.8"
                      />
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth="3.8"
                        strokeDasharray="78, 100"
                        strokeLinecap="round"
                      />
                    </svg>

                    <div style={{ position: 'absolute', textAlign: 'center' }}>
                      <div style={{ fontSize: '22px', fontWeight: '800', color: '#1e293b' }}>78%</div>
                      <div style={{ fontSize: '10px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Achieved</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', background: '#ffffff', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Achieved</div>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#16a34a' }}>
                        ₹{Number(loanData?.CurrentMonthAchieved || 78000000).toLocaleString('en-IN')}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>Target</div>
                      <div style={{ fontSize: '14px', fontWeight: '700', color: '#1e293b' }}>
                        ₹10,00,00,000
                      </div>
                    </div>
                  </div>
                </div>

                {/* Annual Target vs Actual (MoM Bar Chart) */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#334155' }}>Annual Target vs. Actual (MoM)</span>
                    <div style={{ display: 'flex', gap: '10px', fontSize: '11px' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#64748b' }}>
                        <span style={{ width: '8px', height: '8px', background: '#cbd5e1', borderRadius: '2px' }}></span> Target
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#2563eb', fontWeight: '600' }}>
                        <span style={{ width: '8px', height: '8px', background: '#2563eb', borderRadius: '2px' }}></span> Actual
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', height: '110px', padding: '0 8px 6px', borderBottom: '1px solid #cbd5e1' }}>
                    {[
                      { month: 'Apr', target: 60, actual: 55 },
                      { month: 'May', target: 65, actual: 62 },
                      { month: 'Jun', target: 70, actual: 75 },
                      { month: 'Jul', target: 75, actual: 72 },
                      { month: 'Aug', target: 80, actual: 88 },
                      { month: 'Sep', target: 85, actual: 78 }
                    ].map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '12%' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: '90px' }}>
                          <div style={{ width: '8px', height: `${item.target}%`, background: '#cbd5e1', borderRadius: '2px 2px 0 0' }} title={`Target: ${item.target}%`} />
                          <div style={{ width: '8px', height: `${item.actual}%`, background: item.actual >= item.target ? '#16a34a' : '#2563eb', borderRadius: '2px 2px 0 0' }} title={`Actual: ${item.actual}%`} />
                        </div>
                        <span style={{ fontSize: '10px', color: '#64748b', fontWeight: '600' }}>{item.month}</span>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '12px' }}>
                    <span style={{ color: '#64748b' }}>YTD Target: <strong style={{ color: '#1e293b' }}>₹60 Cr</strong></span>
                    <span style={{ color: '#64748b' }}>YTD Achieved: <strong style={{ color: '#16a34a' }}>₹44.40 Cr (78%)</strong></span>
                  </div>
                </div>

              </div>
            </div>

            {/* 2. FINANCIAL PORTFOLIO SUMMARY */}
            <section>
              <h3 style={{ fontSize: '15px', color: '#1e293b', fontWeight: '700', marginBottom: '14px' }}>
                Financial Portfolio Summary
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Total Portfolio</span>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '6px 0 10px' }}>
                    ₹{Number(loanData?.totalLoan || 0).toLocaleString('en-IN')}
                  </div>
                  <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: '100%', height: '100%', background: '#64748b' }}></div>
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Amount Collected</span>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: '#16a34a', margin: '6px 0 10px' }}>
                    ₹{Number(loanData?.amountPaid || 0).toLocaleString('en-IN')}
                  </div>
                  <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ 
                      width: `${Math.min(100, Math.round(((loanData?.amountPaid || 0) / (loanData?.totalLoan || 1)) * 100))}%`, 
                      height: '100%', 
                      background: '#16a34a' 
                    }}></div>
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Outstanding Balance</span>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: '#dc2626', margin: '6px 0 10px' }}>
                    ₹{Number(loanData?.remainingBalance || 0).toLocaleString('en-IN')}
                  </div>
                  <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ 
                      width: `${Math.min(100, Math.round(((loanData?.remainingBalance || 0) / (loanData?.totalLoan || 1)) * 100))}%`, 
                      height: '100%', 
                      background: '#dc2626' 
                    }}></div>
                  </div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Upcoming Cycle Due</span>
                  <div style={{ fontSize: '22px', fontWeight: '700', color: '#2563eb', margin: '6px 0' }}>
                    {loanData?.nextDueDate || 'N/A'}
                  </div>
                  <span style={{ fontSize: '12px', color: '#2563eb', background: '#eff6ff', padding: '2px 8px', borderRadius: '10px', fontWeight: '600' }}>
                    Next Settlement
                  </span>
                </div>
              </div>
            </section>

            {/* 3. LOAN PROCESS PIPELINE */}
            <section>
              <h3 style={{ fontSize: '15px', color: '#1e293b', fontWeight: '700', marginBottom: '14px' }}>
                Overall Loans Status in {loanData?.location || 'All Locations'}
              </h3>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', borderTop: '4px solid #2563eb', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Initiated</span>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#2563eb', background: '#eff6ff', padding: '3px 10px', borderRadius: '12px' }}>
                      {loanData?.loansInitiated || 0} Loans
                    </span>
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#1e293b', margin: '10px 0 6px' }}>
                    ₹{Number(loanData?.InitiatedAmount || 0).toLocaleString('en-IN')}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Stage 1 • Lead Intake</div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', borderTop: '4px solid #d97706', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Sanctioned</span>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#d97706', background: '#fffbeb', padding: '3px 10px', borderRadius: '12px' }}>
                      {loanData?.loansSanctioned || 0} Loans
                    </span>
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#1e293b', margin: '10px 0 6px' }}>
                    ₹{Number(loanData?.SanctionedAmount || 0).toLocaleString('en-IN')}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Stage 2 • Underwriting Approved</div>
                </div>

                <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '18px', borderTop: '4px solid #16a34a', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Disbursed</span>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: '#16a34a', background: '#f0fdf4', padding: '3px 10px', borderRadius: '12px' }}>
                      {loanData?.loansDisbursed || 0} Loans
                    </span>
                  </div>
                  <div style={{ fontSize: '24px', fontWeight: '700', color: '#1e293b', margin: '10px 0 6px' }}>
                    ₹{Number(loanData?.DisbursedAmount || 0).toLocaleString('en-IN')}
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>Stage 3 • Funds Released</div>
                </div>
              </div>
            </section>

            {/* 4. LEADS FUNNEL & SOURCE BREAKDOWN */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <h3 style={{ fontSize: '15px', color: '#1e293b', fontWeight: '700', marginBottom: '16px' }}>
                  Leads Conversion Pipeline
                </h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>
                      <span style={{ color: '#334155' }}>Leads Generated</span>
                      <span style={{ color: '#2563eb' }}>{loanData?.leadsGenerated || 0}</span>
                    </div>
                    <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: '100%', height: '100%', background: '#2563eb' }}></div>
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>
                      <span style={{ color: '#334155' }}>Leads Contacted</span>
                      <span style={{ color: '#d97706' }}>{loanData?.leadsContacted || 0}</span>
                    </div>
                    <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ 
                        width: `${Math.min(100, Math.round(((loanData?.leadsContacted || 0) / (loanData?.leadsGenerated || 1)) * 100))}%`, 
                        height: '100%', 
                        background: '#d97706' 
                      }}></div>
                    </div>
                  </div>

                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '600', marginBottom: '6px' }}>
                      <span style={{ color: '#334155' }}>Leads Converted</span>
                      <span style={{ color: '#16a34a' }}>{loanData?.leadsConverted || 0}</span>
                    </div>
                    <div style={{ height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ 
                        width: `${Math.min(100, Math.round(((loanData?.leadsConverted || 0) / (loanData?.leadsGenerated || 1)) * 100))}%`, 
                        height: '100%', 
                        background: '#16a34a' 
                      }}></div>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '15px', color: '#1e293b', fontWeight: '700' }}>
                    Lead Sources Breakdown
                  </h3>
                  <span style={{ fontSize: '11px', background: '#dbeafe', color: '#1e40af', fontWeight: '700', padding: '2px 8px', borderRadius: '10px', textTransform: 'uppercase' }}>
                    ★ Referral Top
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {[
                    { label: 'Referral', value: loanData?.sourceReferral || 142, pct: 42, color: '#2563eb' },
                    { label: 'Website', value: loanData?.sourceWebsite || 98, pct: 29, color: '#0284c7' },
                    { label: 'Social Media', value: loanData?.sourceSocial || 64, pct: 19, color: '#6366f1' },
                    { label: 'Cold Call', value: loanData?.sourceColdCall || 34, pct: 10, color: '#64748b' },
                  ].map((src, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <span style={{ width: '90px', fontSize: '13px', color: '#475569', fontWeight: '600' }}>{src.label}</span>
                      <div style={{ flex: 1, height: '10px', background: '#f1f5f9', borderRadius: '5px', overflow: 'hidden' }}>
                        <div style={{ width: `${src.pct}%`, height: '100%', background: src.color }}></div>
                      </div>
                      <span style={{ width: '40px', fontSize: '13px', fontWeight: '700', color: '#1e293b', textAlign: 'right' }}>{src.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </>
      )}
    </div>
  )}

                {/* Employee Management Tab */}
                {activeTab === 'employeeRecords' && (
                  <div style={styles.cardSection}>
                    {successMessage && <div style={styles.successBanner}>{successMessage}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h3 style={{ ...styles.sectionTitle, margin: 0 }}>ALL Employee Records</h3>
                      <button onClick={handleAddNewEmployeeClick} style={styles.addNewInlineBtn}>
                        + Add New Employee
                      </button>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={styles.table}>
                        <thead>
                          <tr style={styles.tableHeaderRow}>
                            <th style={styles.th}>ID</th>
                            <th style={styles.th}>Employee Name</th>
                            <th style={styles.th}>Contact Info</th>
                            <th style={styles.th}>KYC Details</th>
                            <th style={styles.th}>Location Details</th>
                            <th style={styles.th}>Status</th>
                            <th style={styles.th}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(employees || []).map((emp) => (
                            <tr key={emp.emp_pk || emp.emp_id} style={styles.tableRow}>
                              <td style={styles.td}>#{emp.emp_id || emp.emp_pk}</td>
                              <td style={styles.td}>
                                <strong>{emp.first_name} {emp.last_name}</strong>
                              </td>
                              <td style={styles.td}>
                                <div style={{ fontSize: '13px' }}>{emp.email}</div>
                                <div style={{ fontSize: '12px', color: '#64748b' }}>{emp.phone}</div>
                              </td>
                              <td style={styles.td}>
                                <div style={{ fontSize: '12px' }}>Aadhaar: <strong>{emp.aadhar || 'N/A'}</strong></div>
                                <div style={{ fontSize: '12px' }}>PAN: <strong>{emp.pan || 'N/A'}</strong></div>
                              </td>
                              <td style={styles.td}>
                                <div style={{ fontSize: '12px' }}>{emp.city}, {emp.district}, {emp.state} - {emp.pin_zip}</div>
                              </td>
                              <td style={styles.td}>
                                <span style={emp.status === 'Inactive' ? styles.badgeClosed : styles.badgeActive}>
                                  {emp.status || 'Active'}
                                </span>
                              </td>
                              <td style={styles.td}>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button
                                    onClick={() => typeof handleEditEmployee === 'function' && handleEditEmployee(emp)}
                                    style={styles.editButton}>
                                    ✏️ Edit
                                  </button>
                                  <button
                                    onClick={() => typeof handleDeleteEmployee === 'function' && handleDeleteEmployee(emp.emp_pk)}
                                    style={styles.deleteButton}>
                                    Inactive
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Add/Edit Employee Tab */}
                {activeTab === 'addEmployee' && (
                  <div style={{ ...styles.formCardContainer, maxWidth: '850px' }}>
                    <h3 style={styles.sectionTitle}>
                      {editEmployeeId ? 'Edit Employee' : 'Enter Employee Personal Information'}
                    </h3>

                    <form onSubmit={handleSaveEmployee} style={styles.addFormGrid}>
                      <div style={{ ...styles.inputGroup, gridColumn: 'span 2' }}>
                        <label style={styles.label}>Employee ID</label>
                        <input
                          type="text"
                          value={editEmployeeId || nextEmployeeId || 'EMP-001'}
                          disabled
                          style={{ ...styles.input, backgroundColor: '#e2e8f0', color: '#64748b' }}
                        />
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Employee First Name *</label>
                        <input
                          type="text"
                          value={newEmployee?.Emp_first_name || ''}
                          onChange={(e) => {
                            setNewEmployee({ ...newEmployee, Emp_first_name: e.target.value });
                            if (EmployeeValidationErrors?.Emp_first_name) {
                              setEmployeeValidationErrors({ ...EmployeeValidationErrors, Emp_first_name: null });
                            }
                          }}
                          style={styles.input}
                          placeholder="e.g. Robert"
                          autoComplete="off"
                        />
                        {EmployeeValidationErrors?.Emp_first_name && (
                          <span style={styles.inlineError}>{EmployeeValidationErrors.Emp_first_name}</span>
                        )}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Employee Last Name *</label>
                        <input
                          type="text"
                          value={newEmployee?.Emp_last_name || ''}
                          onChange={(e) => {
                            setNewEmployee({ ...newEmployee, Emp_last_name: e.target.value });
                            if (EmployeeValidationErrors?.Emp_last_name) {
                              setEmployeeValidationErrors({ ...EmployeeValidationErrors, Emp_last_name: null });
                            }
                          }}
                          style={styles.input}
                          placeholder="e.g. Fox"
                          autoComplete="off"
                        />
                        {EmployeeValidationErrors?.Emp_last_name && (
                          <span style={styles.inlineError}>{EmployeeValidationErrors.Emp_last_name}</span>
                        )}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Email *</label>
                        <input
                          type="email"
                          value={newEmployee?.Emp_email || ''}
                          onChange={(e) => {
                            setNewEmployee({ ...newEmployee, Emp_email: e.target.value });
                            if (EmployeeValidationErrors?.Emp_email) {
                              setEmployeeValidationErrors({ ...EmployeeValidationErrors, Emp_email: null });
                            }
                          }}
                          style={styles.input}
                          placeholder="robert@example.com"
                          autoComplete="off"
                        />
                        {EmployeeValidationErrors?.Emp_email && (
                          <span style={styles.inlineError}>{EmployeeValidationErrors.Emp_email}</span>
                        )}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Phone Number *</label>
                        <input
                          type="text"
                          value={newEmployee?.Emp_phone || ''}
                          onChange={(e) => {
                            setNewEmployee({ ...newEmployee, Emp_phone: e.target.value });
                            if (EmployeeValidationErrors?.Emp_phone) {
                              setEmployeeValidationErrors({ ...EmployeeValidationErrors, Emp_phone: null });
                            }
                          }}
                          style={styles.input}
                          placeholder="+91 98765 43210"
                          autoComplete="off"
                        />
                        {EmployeeValidationErrors?.Emp_phone && (
                          <span style={styles.inlineError}>{EmployeeValidationErrors.Emp_phone}</span>
                        )}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Aadhaar *</label>
                        <input
                          type="text"
                          value={newEmployee?.Emp_aadhaar || ''}
                          onChange={(e) => {
                            setNewEmployee({ ...newEmployee, Emp_aadhaar: e.target.value });
                            if (EmployeeValidationErrors?.Emp_aadhaar) {
                              setEmployeeValidationErrors({ ...EmployeeValidationErrors, Emp_aadhaar: null });
                            }
                          }}
                          style={styles.input}
                          placeholder="XXXX XXXX XXXX"
                          autoComplete="off"
                        />
                        {EmployeeValidationErrors?.Emp_aadhaar && (
                          <span style={styles.inlineError}>{EmployeeValidationErrors.Emp_aadhaar}</span>
                        )}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>PAN *</label>
                        <input
                          type="text"
                          value={newEmployee?.Emp_pan || ''}
                          onChange={(e) => {
                            setNewEmployee({ ...newEmployee, Emp_pan: e.target.value });
                            if (EmployeeValidationErrors?.Emp_pan) {
                              setEmployeeValidationErrors({ ...EmployeeValidationErrors, Emp_pan: null });
                            }
                          }}
                          style={styles.input}
                          placeholder="ABCDE1234F"
                          autoComplete="off"
                        />
                        {EmployeeValidationErrors?.Emp_pan && (
                          <span style={styles.inlineError}>{EmployeeValidationErrors.Emp_pan}</span>
                        )}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Designation Code *</label>
                        <input
                          type="text"
                          value={newEmployee?.Emp_designation_code || ''}
                          onChange={(e) => {
                            setNewEmployee({ ...newEmployee, Emp_designation_code: e.target.value });
                            if (EmployeeValidationErrors?.Emp_designation_code) {
                              setEmployeeValidationErrors({ ...EmployeeValidationErrors, Emp_designation_code: null });
                            }
                          }}
                          style={styles.input}
                          placeholder="e.g. DES01"
                          autoComplete="off"
                        />
                        {EmployeeValidationErrors?.Emp_designation_code && (
                          <span style={styles.inlineError}>{EmployeeValidationErrors.Emp_designation_code}</span>
                        )}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Branch Code (optional)</label>
                        <input
                          type="text"
                          value={newEmployee?.Emp_branch_code || ''}
                          onChange={(e) => setNewEmployee({ ...newEmployee, Emp_branch_code: e.target.value })}
                          style={styles.input}
                          placeholder="e.g. BR01"
                          autoComplete="off"
                        />
                      </div>

                      <div style={{ gridColumn: 'span 2', marginTop: '6px' }}>
                        <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1e293b' }}>Address Information</h4>
                      </div>

                      <div style={{ ...styles.inputGroup, gridColumn: 'span 2' }}>
                        <label style={styles.label}>Address Line 1 *</label>
                        <input
                          type="text"
                          value={newEmployee?.Emp_address_line1 || ''}
                          onChange={(e) => {
                            setNewEmployee({ ...newEmployee, Emp_address_line1: e.target.value });
                            if (EmployeeValidationErrors?.Emp_address_line1) {
                              setEmployeeValidationErrors({ ...EmployeeValidationErrors, Emp_address_line1: null });
                            }
                          }}
                          style={styles.input}
                          placeholder="Street address or building name"
                          autoComplete="off"
                        />
                        {EmployeeValidationErrors?.Emp_address_line1 && (
                          <span style={styles.inlineError}>{EmployeeValidationErrors.Emp_address_line1}</span>
                        )}
                      </div>

                      <div style={{ ...styles.inputGroup, gridColumn: 'span 2' }}>
                        <label style={styles.label}>Address Line 2 (optional)</label>
                        <input
                          type="text"
                          value={newEmployee?.Emp_address_line2 || ''}
                          onChange={(e) => setNewEmployee({ ...newEmployee, Emp_address_line2: e.target.value })}
                          style={styles.input}
                          placeholder="Apt, suite, unit, building, floor, etc."
                          autoComplete="off"
                        />
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>State *</label>
                        <select
                          value={newEmployee?.Emp_state || ''}
                          onChange={(e) => {
                            setNewEmployee({ ...newEmployee, Emp_state: e.target.value, Emp_district: '', Emp_city: '' });
                            if (EmployeeValidationErrors?.Emp_state) {
                              setEmployeeValidationErrors({ ...EmployeeValidationErrors, Emp_state: null });
                            }
                          }}
                          style={styles.input}
                          required
                        >
                          <option value="">-- Select State --</option>
                          {Object.keys(INDIA_LOCATIONS || {}).map((st) => (
                            <option key={st} value={st}>{st}</option>
                          ))}
                        </select>
                        {EmployeeValidationErrors?.Emp_state && (
                          <span style={styles.inlineError}>{EmployeeValidationErrors.Emp_state}</span>
                        )}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>District *</label>
                        <select
                          value={newEmployee?.Emp_district || ''}
                          onChange={(e) => {
                            setNewEmployee({ ...newEmployee, Emp_district: e.target.value, Emp_city: '' });
                            if (EmployeeValidationErrors?.Emp_district) {
                              setEmployeeValidationErrors({ ...EmployeeValidationErrors, Emp_district: null });
                            }
                          }}
                          style={styles.input}
                          required
                        >
                          <option value="">-- Select District --</option>
                          {(availableDistricts || []).map((dist) => (
                            <option key={dist} value={dist}>{dist}</option>
                          ))}
                        </select>
                        {EmployeeValidationErrors?.Emp_district && (
                          <span style={styles.inlineError}>{EmployeeValidationErrors.Emp_district}</span>
                        )}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>City / Town *</label>
                        <select
                          value={newEmployee?.Emp_city || ''}
                          onChange={(e) => {
                            setNewEmployee({ ...newEmployee, Emp_city: e.target.value });
                            if (EmployeeValidationErrors?.Emp_city) {
                              setEmployeeValidationErrors({ ...EmployeeValidationErrors, Emp_city: null });
                            }
                          }}
                          style={styles.input}
                          required
                        >
                          <option value="">-- Select City --</option>
                          {(availableCities || []).map((ct) => (
                            <option key={ct} value={ct}>{ct}</option>
                          ))}
                        </select>
                        {EmployeeValidationErrors?.Emp_city && (
                          <span style={styles.inlineError}>{EmployeeValidationErrors.Emp_city}</span>
                        )}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Pincode *</label>
                        <input
                          type="text"
                          maxLength="6"
                          value={newEmployee?.Emp_pin_zip || ''}
                          onChange={(e) => {
                            setNewEmployee({ ...newEmployee, Emp_pin_zip: e.target.value });
                            if (EmployeeValidationErrors?.Emp_pin_zip) {
                              setEmployeeValidationErrors({ ...EmployeeValidationErrors, Emp_pin_zip: null });
                            }
                          }}
                          style={styles.input}
                          placeholder="6-digit PIN code"
                          autoComplete="off"
                        />
                        {EmployeeValidationErrors?.Emp_pin_zip && (
                          <span style={styles.inlineError}>{EmployeeValidationErrors.Emp_pin_zip}</span>
                        )}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Country</label>
                        <input
                          type="text"
                          value={newEmployee?.Emp_country || 'India'}
                          onChange={(e) => setNewEmployee({ ...newEmployee, Emp_country: e.target.value })}
                          style={styles.input}
                          placeholder="India"
                          autoComplete="off"
                        />
                      </div>

                      {EmployeeTopError && <div style={{ ...styles.errorBanner, gridColumn: 'span 2' }}>{EmployeeTopError}</div>}
                      {successMessage && <div style={{ ...styles.successBanner, gridColumn: 'span 2' }}>{successMessage}</div>}

                      <div style={{ gridColumn: 'span 2', display: 'flex', gap: '12px', marginTop: '10px' }}>
                        <button type="submit" style={{ ...styles.submitButton, flex: 1, marginTop: 0 }}>
                          Register Employee
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (typeof clearEmployeeForm === 'function') clearEmployeeForm();
                            setActiveTab('employeeRecords');
                          }}
                          style={{ flex: 1, background: '#e2e8f0', color: '#334155', border: '1px solid #cbd5e1', padding: '12px', borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {/* Start of Customer Landing Page */}
                {activeTab === 'customerRecords' && (
                  <div style={styles.cardSection}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h3 style={{ ...styles.sectionTitle, margin: 0 }}>ALL Customer Records </h3>
                      <button onClick={handleAddNewTabClick} style={styles.addNewInlineBtn}>+ Add New Customer</button>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={styles.table}>
                        <thead>
                          <tr style={styles.tableHeaderRow}>
                            <th style={styles.th}>ID</th>
                            <th style={styles.th}>Customer Name</th>
                            <th style={styles.th}>Contact Info</th>
                            <th style={styles.th}>KYC Details</th>
                            <th style={styles.th}>Location Details</th>
                            <th style={styles.th}>Status</th>
                            <th style={styles.th}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customers.map((c) => (
                            <tr key={c.cust_pk} style={styles.tableRow}>
                              <td style={styles.td}>#{c.cust_id || c.cust_pk}</td>
                              <td style={styles.td}>
                                <strong>{c.first_name} {c.last_name}</strong>
                              </td>
                              <td style={styles.td}>
                                <div style={{ fontSize: '13px' }}>{c.email}</div>
                                <div style={{ fontSize: '12px', color: '#64748b' }}>{c.phone}</div>
                              </td>
                              <td style={styles.td}>
                                <div style={{ fontSize: '12px' }}>Aadhaar: <strong>{c.aadhaar || 'N/A'}</strong></div>
                                <div style={{ fontSize: '12px' }}>PAN: <strong>{c.pan || 'N/A'}</strong></div>
                              </td>
                              <td style={styles.td}>
                                <div style={{ fontSize: '12px' }}>{c.city}, {c.district}, {c.state} - {c.pin_zip}</div>
                              </td>
                              <td style={styles.td}>
                                <span style={c.status === 'Closed' ? styles.badgeClosed : styles.badgeActive}>
                                  {c.status || 'Active'}
                                </span>
                              </td>
                              <td style={styles.td}>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button
                                    onClick={() => handleEditClick(c)}
                                    style={styles.editButton}>
                                    ✏️ Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteCustomer(c.cust_pk)}
                                    style={styles.deleteButton}>
                                    Inactive
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {/* End of Customer Landing Page */}

                {activeTab === 'addCustomer' && (
                  <div style={{ ...styles.formCardContainer, maxWidth: '850px' }}>
                    <h3 style={styles.sectionTitle}>
                      {editId !== null ? 'Edit Customer' : 'Enter Customer Personal Information'}
                    </h3>

                    <form onSubmit={handleSaveCustomer} style={styles.addFormGrid}>
                      <div style={{ ...styles.inputGroup, gridColumn: 'span 2' }}>
                        <label style={styles.label}>Customer ID</label>
                        <input
                          type="text"
                          value={editId !== null ? editingCustomerIdValue : nextCustomerId}
                          disabled
                          style={{ ...styles.input, backgroundColor: '#e2e8f0', color: '#64748b' }}
                        />
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Customer First Name *</label>
                        <input
                          type="text"
                          value={newCustomer.cust_first_name}
                          onChange={(e) => {
                            setNewCustomer({ ...newCustomer, cust_first_name: e.target.value });
                            if (customerValidationErrors.cust_first_name) setCustomerValidationErrors({ ...customerValidationErrors, cust_first_name: null });
                          }}
                          style={styles.input}
                          placeholder="e.g. Robert"
                          autoComplete="off"
                        />
                        {customerValidationErrors.cust_first_name && <span style={styles.inlineError}>{customerValidationErrors.cust_first_name}</span>}
                      </div>
                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Customer Last Name *</label>
                        <input
                          type="text"
                          value={newCustomer.cust_last_name}
                          onChange={(e) => {
                            setNewCustomer({ ...newCustomer, cust_last_name: e.target.value });
                            if (customerValidationErrors.cust_last_name) setCustomerValidationErrors({ ...customerValidationErrors, cust_last_name: null });
                          }}
                          style={styles.input}
                          placeholder="e.g. Fox"
                          autoComplete="off"
                        />
                        {customerValidationErrors.cust_last_name && <span style={styles.inlineError}>{customerValidationErrors.cust_last_name}</span>}
                      </div>
                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Email *</label>
                        <input
                          type="email"
                          value={newCustomer.cust_email}
                          onChange={(e) => {
                            setNewCustomer({ ...newCustomer, cust_email: e.target.value });
                            if (customerValidationErrors.cust_email) setCustomerValidationErrors({ ...customerValidationErrors, cust_email: null });
                          }}
                          style={styles.input}
                          placeholder="robert@example.com"
                          autoComplete="off"
                        />
                        {customerValidationErrors.cust_email && <span style={styles.inlineError}>{customerValidationErrors.cust_email}</span>}
                      </div>
                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Phone Number *</label>
                        <input
                          type="text"
                          value={newCustomer.cust_phone}
                          onChange={(e) => {
                            setNewCustomer({ ...newCustomer, cust_phone: e.target.value });
                            if (customerValidationErrors.cust_phone) setCustomerValidationErrors({ ...customerValidationErrors, cust_phone: null });
                          }}
                          style={styles.input}
                          placeholder="+91 98765 43210"
                          autoComplete="off"
                        />
                        {customerValidationErrors.cust_phone && <span style={styles.inlineError}>{customerValidationErrors.cust_phone}</span>}
                      </div>
                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Aadhaar *</label>
                        <input
                          type="text"
                          value={newCustomer.cust_aadhaar}
                          onChange={(e) => {
                            setNewCustomer({ ...newCustomer, cust_aadhaar: e.target.value });
                            if (customerValidationErrors.cust_aadhaar) setCustomerValidationErrors({ ...customerValidationErrors, cust_aadhaar: null });
                          }}
                          style={styles.input}
                          placeholder="XXXX XXXX XXXX"
                          autoComplete="off"
                        />
                        {customerValidationErrors.cust_aadhaar && <span style={styles.inlineError}>{customerValidationErrors.cust_aadhaar}</span>}
                      </div>
                      <div style={styles.inputGroup}>
                        <label style={styles.label}>PAN *</label>
                        <input
                          type="text"
                          value={newCustomer.cust_pan}
                          onChange={(e) => {
                            setNewCustomer({ ...newCustomer, cust_pan: e.target.value });
                            if (customerValidationErrors.cust_pan) setCustomerValidationErrors({ ...customerValidationErrors, cust_pan: null });
                          }}
                          style={styles.input}
                          placeholder="ABCDE1234F"
                          autoComplete="off"
                        />
                        {customerValidationErrors.cust_pan && <span style={styles.inlineError}>{customerValidationErrors.cust_pan}</span>}
                      </div>

                      <div style={{ gridColumn: 'span 2', marginTop: '6px' }}>
                        <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1e293b' }}>Address Information</h4>
                      </div>

                      <div style={{ ...styles.inputGroup, gridColumn: 'span 2' }}>
                        <label style={styles.label}>Address Line 1 *</label>
                        <input
                          type="text"
                          value={newCustomer.cust_address_line1}
                          onChange={(e) => {
                            setNewCustomer({ ...newCustomer, cust_address_line1: e.target.value });
                            if (customerValidationErrors.cust_address_line1) setCustomerValidationErrors({ ...customerValidationErrors, cust_address_line1: null });
                          }}
                          style={styles.input}
                          placeholder="Street address or building name"
                          autoComplete="off"
                        />
                        {customerValidationErrors.cust_address_line1 && <span style={styles.inlineError}>{customerValidationErrors.cust_address_line1}</span>}
                      </div>

                      <div style={{ ...styles.inputGroup, gridColumn: 'span 2' }}>
                        <label style={styles.label}>Address Line 2 (optional)</label>
                        <input
                          type="text"
                          value={newCustomer.cust_address_line2}
                          onChange={(e) => setNewCustomer({ ...newCustomer, cust_address_line2: e.target.value })}
                          style={styles.input}
                          placeholder="Apt, suite, unit, building, floor, etc."
                          autoComplete="off"
                        />
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>State *</label>
                        <select
                          value={newCustomer.cust_state}
                          onChange={(e) => {
                            setNewCustomer({ ...newCustomer, cust_state: e.target.value, cust_district: '', cust_city: '' });
                            if (customerValidationErrors.cust_state) setCustomerValidationErrors({ ...customerValidationErrors, cust_state: null });
                          }}
                          style={styles.input}
                          required
                        >
                          <option value="">-- Select State --</option>
                          {Object.keys(INDIA_LOCATIONS).map((st) => (
                            <option key={st} value={st}>{st}</option>
                          ))}
                        </select>
                        {customerValidationErrors.cust_state && <span style={styles.inlineError}>{customerValidationErrors.cust_state}</span>}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>District *</label>
                        <select
                          value={newCustomer.cust_district}
                          onChange={(e) => {
                            setNewCustomer({ ...newCustomer, cust_district: e.target.value, cust_city: '' });
                            if (customerValidationErrors.cust_district) setCustomerValidationErrors({ ...customerValidationErrors, cust_district: null });
                          }}
                          style={styles.input}
                          required
                        >
                          <option value="">-- Select District --</option>
                          {availableDistricts.map((dist) => (
                            <option key={dist} value={dist}>{dist}</option>
                          ))}
                        </select>
                        {customerValidationErrors.cust_district && <span style={styles.inlineError}>{customerValidationErrors.cust_district}</span>}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>City / Town *</label>
                        <select
                          value={newCustomer.cust_city}
                          onChange={(e) => {
                            setNewCustomer({ ...newCustomer, cust_city: e.target.value });
                            if (customerValidationErrors.cust_city) setCustomerValidationErrors({ ...customerValidationErrors, cust_city: null });
                          }}
                          style={styles.input}
                          required
                        >
                          <option value="">-- Select City --</option>
                          {availableCities.map((ct) => (
                            <option key={ct} value={ct}>{ct}</option>
                          ))}
                        </select>
                        {customerValidationErrors.cust_city && <span style={styles.inlineError}>{customerValidationErrors.cust_city}</span>}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Pincode *</label>
                        <input
                          type="text"
                          maxLength="6"
                          value={newCustomer.cust_pin_zip}
                          onChange={(e) => {
                            setNewCustomer({ ...newCustomer, cust_pin_zip: e.target.value });
                            if (customerValidationErrors.cust_pin_zip) setCustomerValidationErrors({ ...customerValidationErrors, cust_pin_zip: null });
                          }}
                          style={styles.input}
                          placeholder="6-digit PIN code"
                          autoComplete="off"
                        />
                        {customerValidationErrors.cust_pin_zip && <span style={styles.inlineError}>{customerValidationErrors.cust_pin_zip}</span>}
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Country</label>
                        <input
                          type="text"
                          value={newCustomer.cust_country}
                          onChange={(e) => setNewCustomer({ ...newCustomer, cust_country: e.target.value })}
                          style={styles.input}
                          placeholder="India"
                          autoComplete="off"
                        />
                      </div>

                      {customerTopError && <div style={{ ...styles.errorBanner, gridColumn: 'span 2' }}>{customerTopError}</div>}
                      {successMessage && <div style={{ ...styles.successBanner, gridColumn: 'span 2' }}>{successMessage}</div>}

                      <div style={{ gridColumn: 'span 2', display: 'flex', gap: '12px', marginTop: '10px' }}>
                        <button type="submit" style={{ ...styles.submitButton, flex: 1, marginTop: 0 }}>
                          Register Customer
                        </button>
                        <button type="button" onClick={() => { clearCustomerForm(); setActiveTab('dashboard'); }} style={{ flex: 1, background: '#e2e8f0', color: '#334155', border: '1px solid #cbd5e1', padding: '12px', borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {activeTab === 'repaymentSchedule' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '290px 1fr', gap: '16px' }}>
                    <div style={styles.cardSection}>
                      <h3 style={styles.sectionTitle}>Loan Details</h3>
                      <form onSubmit={handleGenerateSchedule} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={styles.inputGroup}>
                          <label style={styles.label}>Loan Type</label>
                          <select
                            value={loanInput.loanType}
                            onChange={(e) => setLoanInput({ ...loanInput, loanType: e.target.value })}
                            style={styles.input}
                            required
                          >
                            <option value="Term Loan">Term Loan</option>
                            <option value="OD Loan">OD Loan</option>
                            <option value="Home Loan">Home Loan</option>
                            <option value="Personal Loan">Personal Loan</option>
                            <option value="Vehicle Loan">Vehicle Loan</option>
                            <option value="Business Loan">Business Loan</option>
                            <option value="Gold loan">Gold loan</option>
                          </select>
                        </div>

                        <div style={styles.inputGroup}>
                          <label style={styles.label}>Loan Amount (₹)</label>
                          <input
                            type="number"
                            value={loanInput.principal}
                            onChange={(e) => handlePrincipalChange(e.target.value)}
                            style={styles.input}
                            required
                          />
                        </div>
                        <div style={styles.inputGroup}>
                          <label style={styles.label}>Interest Rate (%)</label>
                          <input
                            type="number"
                            step="0.1"
                            value={loanInput.rate}
                            onChange={(e) => setLoanInput({ ...loanInput, rate: e.target.value })}
                            style={styles.input}
                            required
                          />
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                          <div style={{ ...styles.inputGroup, flex: 1.2 }}>
                            <label style={styles.label}>Tenure</label>
                            <input
                              type="number"
                              value={loanInput.tenureValue}
                              onChange={(e) => handleTenureChange(e.target.value, loanInput.tenureUnit)}
                              style={styles.input}
                              required
                            />
                          </div>
                          <div style={{ ...styles.inputGroup, flex: 1.8 }}>
                            <label style={styles.label}>Unit</label>
                            <select
                              value={loanInput.tenureUnit}
                              onChange={(e) => handleTenureChange(loanInput.tenureValue, e.target.value)}
                              style={styles.input}
                            >
                              <option value="Months">Months</option>
                              <option value="Weeks">Weeks</option>
                              <option value="Years">Years</option>
                            </select>
                          </div>
                        </div>
                        <div style={styles.inputGroup}>
                          <label style={styles.label}>Frequency</label>
                          <select
                            value={loanInput.frequency}
                            onChange={(e) => setLoanInput({ ...loanInput, frequency: e.target.value })}
                            style={styles.input}
                          >
                            <option value="Monthly">Monthly</option>
                            <option value="Biweekly">Biweekly</option>
                            <option value="Weekly">Weekly</option>
                          </select>
                        </div>
                        <div style={styles.inputGroup}>
                          <label style={styles.label}>Processing Fee (%)</label>
                          <input
                            type="number"
                            step="0.1"
                            value={loanInput.feePercentage}
                            onChange={(e) => setLoanInput({ ...loanInput, feePercentage: e.target.value })}
                            style={styles.input}
                            required
                          />
                        </div>
                        {/* Side-by-side Subsidized Amount and Subsidized % */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <div style={{ ...styles.inputGroup, flex: 1 }}>
                            <label style={styles.label}>Subsidized Amt (₹)</label>
                            <input
                              type="number"
                              value={loanInput.subsidizedAmount}
                              onChange={(e) => handleSubsidizedAmountChange(e.target.value)}
                              style={styles.input}
                              required
                            />
                          </div>
                          <div style={{ ...styles.inputGroup, flex: 1 }}>
                            <label style={styles.label}>Subsidized %</label>
                            <input
                              type="text"
                              value={`${loanInput.subsidizedPercent}%`}
                              disabled
                              style={{ ...styles.input, backgroundColor: '#e2e8f0', color: '#64748b' }}
                            />
                          </div>
                        </div>
                        <div style={styles.inputGroup}>
                          <label style={styles.label}>Disbursement Date</label>
                          <input
                            type="date"
                            value={loanInput.disbDate}
                            onChange={handleDisbursementDateChange}
                            style={styles.input}
                            required
                          />
                        </div>

                        <div style={styles.inputGroup}>
                          <label style={styles.label}>First Installment Date</label>
                          <input
                            type="date"
                            value={loanInput.firstInstallmentDate}
                            onChange={(e) => setLoanInput({ ...loanInput, firstInstallmentDate: e.target.value })}
                            style={{ ...styles.input }}
                          />
                        </div>
                        <div style={styles.inputGroup}>
                          <label style={styles.label}>Loan End Date</label>
                          <input
                            type="date"
                            value={loanInput.loanEndDate}
                            disabled
                            style={{ ...styles.input, backgroundColor: '#e2e8f0', color: '#64748b' }}
                          />
                        </div>

                        <button type="submit" style={styles.primaryButton}>
                          Generate Schedule
                        </button>
                      </form>
                    </div>

                    <div style={styles.cardSection}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                        <h3 style={{ ...styles.sectionTitle, margin: 0 }}>Repayment and Amortization Breakdown</h3>
                        {scheduleResult && (
                          <button
                            onClick={() => exportRepaymentScheduleToPDF(loanInput, scheduleResult)}
                            style={styles.pdfExportButton}
                          >
                            📥 Download PDF
                          </button>
                        )}
                      </div>

                      {!scheduleResult ? (
                        <p style={{ color: '#64748b', fontSize: '14px' }}>
                          Configure your loan details on the left and click <strong>Generate Schedule</strong> to preview installment timelines.
                        </p>
                      ) : (
                        <div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                            <div style={styles.subMetricCard}>
                              <span style={styles.subMetricLabel}>Fixed EMI</span>
                              <span style={styles.subMetricVal}>{fmtRupee(scheduleResult.computedEmi)}</span>
                            </div>
                            <div style={styles.subMetricCard}>
                              <span style={styles.subMetricLabel}>Total Interest</span>
                              <span style={styles.subMetricVal}>{fmtRupee(scheduleResult.totalInterest)}</span>
                            </div>
                            <div style={styles.subMetricCard}>
                              <span style={styles.subMetricLabel}>Agreement Value</span>
                              <span style={styles.subMetricVal}>{fmtRupee(scheduleResult.agreementValue)}</span>
                            </div>
                            <div style={styles.subMetricCard}>
                              <span style={styles.subMetricLabel}>Installments</span>
                              <span style={styles.subMetricVal}>{scheduleResult.nInstallments}</span>
                            </div>
                            <div style={styles.subMetricCard}>
                              <span style={styles.subMetricLabel}>Customer IRR</span>
                              <span style={styles.subMetricVal}>{scheduleResult.customerIRR}%</span>
                            </div>
                            <div style={styles.subMetricCard}>
                              <span style={styles.subMetricLabel}>Business IRR</span>
                              <span style={{ ...styles.subMetricVal, color: '#2563eb' }}>{scheduleResult.businessIRR}%</span>
                            </div>
                          </div>

                          <div style={{ overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
                            <table style={styles.table}>
                              <thead>
                                <tr style={{ ...styles.tableHeaderRow, position: 'sticky', top: 0, zIndex: 1 }}>
                                  <th style={styles.th}>No.</th>
                                  <th style={styles.th}>Disbursed</th>
                                  <th style={styles.th}>Due Date</th>
                                  <th style={styles.th}>Days</th>
                                  <th style={styles.th}>Opening Bal</th>
                                  <th style={styles.th}>EMI</th>
                                  <th style={styles.th}>Principal</th>
                                  <th style={styles.th}>Interest</th>
                                  <th style={styles.th}>Closing Bal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {scheduleResult.schedule.map((row, idx) => (
                                  <tr key={idx} style={styles.tableRow}>
                                    <td style={styles.td}>{row.installmentNo}</td>
                                    <td style={styles.td}>{row.disbursementDate}</td>
                                    <td style={styles.td}>{row.dueDate}</td>
                                    <td style={styles.td}>{row.daysInPeriod}</td>
                                    <td style={styles.td}>{fmtRupee(row.openingBalance)}</td>
                                    <td style={styles.td}><strong>{fmtRupee(row.emi)}</strong></td>
                                    <td style={styles.td}>{fmtRupee(row.principalPaid)}</td>
                                    <td style={styles.td}>{fmtRupee(row.interestPaid)}</td>
                                    <td style={styles.td}>{fmtRupee(row.closingBalance)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === 'loanRecords' && (
                  <div style={styles.cardSection}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h3 style={{ ...styles.sectionTitle, margin: 0 }}>ALL Loan Records </h3>
                      <button onClick={handleAddNewLoanClick} style={styles.addNewInlineBtn}>+ Add New Loan</button>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={styles.table}>
                        <thead>
                          <tr style={styles.tableHeaderRow}>
                            <th style={styles.th}>ID</th>
                            <th style={styles.th}>Client Name</th>
                            <th style={styles.th}>Contact Info</th>
                            <th style={styles.th}>KYC Details</th>
                            <th style={styles.th}>Location Details</th>
                            <th style={styles.th}>Status</th>
                            <th style={styles.th}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customers.map((c) => (
                            <tr key={c.cust_pk} style={styles.tableRow}>
                              <td style={styles.td}>#{c.cust_id || c.cust_pk}</td>
                              <td style={styles.td}>
                                <strong>{c.first_name} {c.last_name}</strong>
                              </td>
                              <td style={styles.td}>
                                <div style={{ fontSize: '13px' }}>{c.email}</div>
                                <div style={{ fontSize: '12px', color: '#64748b' }}>{c.phone}</div>
                              </td>
                              <td style={styles.td}>
                                <div style={{ fontSize: '12px' }}>Aadhaar: <strong>{c.aadhaar || 'N/A'}</strong></div>
                                <div style={{ fontSize: '12px' }}>PAN: <strong>{c.pan || 'N/A'}</strong></div>
                              </td>
                              <td style={styles.td}>
                                <div style={{ fontSize: '12px' }}>{c.city}, {c.district}, {c.state} - {c.pin_zip}</div>
                              </td>
                              <td style={styles.td}>
                                <span style={c.status === 'Closed' ? styles.badgeClosed : styles.badgeActive}>
                                  {c.status || 'Active'}
                                </span>
                              </td>
                              <td style={styles.td}>
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button
                                    onClick={() => handleEditClick(c)}
                                    style={styles.editButton}>
                                    ✏️ Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteCustomer(c.cust_pk)}
                                    style={styles.deleteButton}>
                                    Inactive
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {activeTab === 'addNewLoan' && (
                  <div style={{ ...styles.formCardContainer, maxWidth: '850px' }}>
                    <h3 style={styles.sectionTitle}>Add New Loan</h3>

                    <form onSubmit={handleNewLoanNext} style={styles.addFormGrid}>
                      <div style={{ ...styles.inputGroup, gridColumn: 'span 2' }}>
                        <label style={styles.label}>Loan Id</label> {/* 👈 FIXED: Removed the extra opening bracket */}
                        <input
                          type="text"
                          value={newLoanForm.loanId}
                          disabled
                          style={{ ...styles.input, backgroundColor: '#e2e8f0', color: '#64748b', fontWeight: '700' }}
                        />
                      </div>

                      {/* --- 1. SEARCHABLE MAIN BORROWER --- */}
                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Select Borrower</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <input
                            type="text"
                            list="main-borrowers-dl"
                            placeholder="Type to search borrower..."
                            value={newLoanForm.borrowerSearch}
                            onChange={(e) => {
                              const val = e.target.value;
                              const match = customers.find(c => `${c.first_name} ${c.last_name} (#${c.cust_id || c.cust_pk})` === val);
                              setNewLoanForm({
                                ...newLoanForm,
                                borrowerSearch: val,
                                selectedBorrower: match ? String(match.cust_pk) : ''
                              });
                            }}
                            style={styles.input}
                            required
                          />
                          <datalist id="main-borrowers-dl">
                            {customers
                              .filter(c => c.status !== 'Closed')
                              .map(c => (
                                <option key={c.cust_pk} value={`${c.first_name} ${c.last_name} (#${c.cust_id || c.cust_pk})`} />
                              ))}
                          </datalist>
                        </div>
                      </div>

                      {/* --- 2. SEARCHABLE CO-BORROWER 1 (Excludes Main Borrower) --- */}
                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Select Co-Borrower 1</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <input
                            type="text"
                            list="co-borrower1-dl"
                            placeholder="Type to search co-borrower 1..."
                            value={newLoanForm.coBorrower1Search}
                            onChange={(e) => {
                              const val = e.target.value;
                              const match = customers.find(c => `${c.first_name} ${c.last_name} (#${c.cust_id || c.cust_pk})` === val);
                              setNewLoanForm({
                                ...newLoanForm,
                                coBorrower1Search: val,
                                coBorrower1: match ? String(match.cust_pk) : ''
                              });
                            }}
                            style={styles.input}
                            required
                          />
                          <datalist id="co-borrower1-dl">
                            {customers
                              .filter(c => c.status !== 'Closed' && String(c.cust_pk) !== String(newLoanForm.selectedBorrower))
                              .map(c => (
                                <option key={c.cust_pk} value={`${c.first_name} ${c.last_name} (#${c.cust_id || c.cust_pk})`} />
                              ))}
                          </datalist>
                        </div>
                      </div>

                      {/* --- 3. SEARCHABLE CO-BORROWER 2 (Excludes Borrower & Co-Borrower 1) --- */}
                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Select Co-Borrower 2 (Optional)</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <input
                            type="text"
                            list="co-borrower2-dl"
                            placeholder="Type to search co-borrower 2..."
                            value={newLoanForm.coBorrower2Search}
                            onChange={(e) => {
                              const val = e.target.value;
                              const match = customers.find(c => `${c.first_name} ${c.last_name} (#${c.cust_id || c.cust_pk})` === val);
                              setNewLoanForm({
                                ...newLoanForm,
                                coBorrower2Search: val,
                                coBorrower2: match ? String(match.cust_pk) : ''
                              });
                            }}
                            style={styles.input}
                          />
                          <datalist id="co-borrower2-dl">
                            {customers
                              .filter(c =>
                                c.status !== 'Closed' &&
                                String(c.cust_pk) !== String(newLoanForm.selectedBorrower) &&
                                String(c.cust_pk) !== String(newLoanForm.coBorrower1)
                              )
                              .map(c => (
                                <option key={c.cust_pk} value={`${c.first_name} ${c.last_name} (#${c.cust_id || c.cust_pk})`} />
                              ))}
                          </datalist>
                        </div>
                      </div>

                      <div style={{ gridColumn: 'span 2', marginTop: '10px' }}>
                        <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1e293b' }}>Loan Information</h4>
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Loan Amount (₹)</label>
                        <input
                          type="number"
                          value={newLoanForm.principal}
                          onChange={(e) => setNewLoanForm({ ...newLoanForm, principal: e.target.value })}
                          style={styles.input}
                          required
                        />
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Interest Rate (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={newLoanForm.rate}
                          onChange={(e) => setNewLoanForm({ ...newLoanForm, rate: e.target.value })}
                          style={styles.input}
                          required
                        />
                      </div>

                      <div style={{ display: 'flex', gap: '8px', gridColumn: 'span 2' }}>
                        <div style={{ ...styles.inputGroup, flex: 1 }}>
                          <label style={styles.label}>Tenure</label>
                          <input
                            type="number"
                            value={newLoanForm.tenureValue}
                            onChange={(e) => setNewLoanForm({ ...newLoanForm, tenureValue: e.target.value })}
                            style={styles.input}
                            required
                          />
                        </div>
                        <div style={{ ...styles.inputGroup, flex: 1 }}>
                          <label style={styles.label}>Unit</label>
                          <select
                            value={newLoanForm.tenureUnit}
                            onChange={(e) => setNewLoanForm({ ...newLoanForm, tenureUnit: e.target.value })}
                            style={styles.input}
                          >
                            <option value="Months">Months</option>
                            <option value="Weeks">Weeks</option>
                            <option value="Years">Years</option>
                          </select>
                        </div>
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Frequency</label>
                        <select
                          value={newLoanForm.frequency}
                          onChange={(e) => setNewLoanForm({ ...newLoanForm, frequency: e.target.value })}
                          style={styles.input}
                        >
                          <option value="Monthly">Monthly</option>
                          <option value="Biweekly">Biweekly</option>
                          <option value="Weekly">Weekly</option>
                        </select>
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Disbursement Date (YYYY / MM / DD)</label>
                        <input
                          type="date"
                          value={newLoanForm.disbDate}
                          onChange={handleNewLoanDisbDateChange}
                          style={styles.input}
                          required
                        />
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>First Installment Date</label>
                        <input
                          type="date"
                          value={newLoanForm.firstInstallmentDate}
                          disabled
                          style={{ ...styles.input, backgroundColor: '#e2e8f0', color: '#64748b' }}
                        />
                      </div>

                      <div style={styles.inputGroup}>
                        <label style={styles.label}>Loan End Date</label>
                        <input
                          type="date"
                          value={newLoanForm.loanEndDate}
                          disabled
                          style={{ ...styles.input, backgroundColor: '#e2e8f0', color: '#64748b' }}
                        />
                      </div>

                      <div style={{ gridColumn: 'span 2', display: 'flex', gap: '12px', marginTop: '10px' }}>
                        <button type="submit" style={{ ...styles.primaryButton, flex: 1, marginTop: 0 }}>
                          NEXT (Calculate Repayment)
                        </button>
                        <button type="button" onClick={() => setActiveTab('loanRecords')} style={{ flex: 1, background: '#e2e8f0', color: '#334155', border: '1px solid #cbd5e1', padding: '12px', borderRadius: '6px', fontSize: '14px', fontWeight: '600', cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {activeTab === 'reviewRepaymentSchedule' && (
                  <div style={styles.cardSection}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                      <h3 style={{ ...styles.sectionTitle, margin: 0 }}>Review Repayment Schedule & Submit Loan</h3>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                          onClick={handleReviewSubmitAndDownloadPDF}
                          style={styles.pdfExportButton}
                        >
                          Submit Loan & Download PDF
                        </button>
                        <button
                          onClick={() => setActiveTab('addNewLoan')}
                          style={{ background: '#64748b', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
                        >
                          Back
                        </button>
                      </div>
                    </div>

                    {!reviewScheduleData ? (
                      <p style={{ color: '#64748b', fontSize: '14px' }}>No schedule generated yet.</p>
                    ) : (
                      <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '10px', marginBottom: '16px' }}>
                          <div style={styles.subMetricCard}>
                            <span style={styles.subMetricLabel}>Fixed EMI</span>
                            <span style={styles.subMetricVal}>{fmtRupee(reviewScheduleData.computedEmi)}</span>
                          </div>
                          <div style={styles.subMetricCard}>
                            <span style={styles.subMetricLabel}>Total Interest</span>
                            <span style={styles.subMetricVal}>{fmtRupee(reviewScheduleData.totalInterest)}</span>
                          </div>
                          <div style={styles.subMetricCard}>
                            <span style={styles.subMetricLabel}>Agreement Value</span>
                            <span style={styles.subMetricVal}>{fmtRupee(reviewScheduleData.agreementValue)}</span>
                          </div>
                          <div style={styles.subMetricCard}>
                            <span style={styles.subMetricLabel}>Installments</span>
                            <span style={styles.subMetricVal}>{reviewScheduleData.nInstallments}</span>
                          </div>
                          <div style={styles.subMetricCard}>
                            <span style={styles.subMetricLabel}>Customer IRR</span>
                            <span style={styles.subMetricVal}>{reviewScheduleData.customerIRR}%</span>
                          </div>
                          <div style={styles.subMetricCard}>
                            <span style={styles.subMetricLabel}>Business IRR</span>
                            <span style={{ ...styles.subMetricVal, color: '#2563eb' }}>{reviewScheduleData.businessIRR}%</span>
                          </div>
                        </div>

                        <div style={{ overflowX: 'auto', maxHeight: '520px', overflowY: 'auto' }}>
                          <table style={styles.table}>
                            <thead>
                              <tr style={{ ...styles.tableHeaderRow, position: 'sticky', top: 0, zIndex: 1 }}>
                                <th style={styles.th}>No.</th>
                                <th style={styles.th}>Disbursed</th>
                                <th style={styles.th}>Due Date</th>
                                <th style={styles.th}>Days</th>
                                <th style={styles.th}>Opening Bal</th>
                                <th style={styles.th}>EMI</th>
                                <th style={styles.th}>Principal</th>
                                <th style={styles.th}>Interest</th>
                                <th style={styles.th}>Closing Bal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {reviewScheduleData.schedule.map((row, idx) => (
                                <tr key={idx} style={styles.tableRow}>
                                  <td style={styles.td}>{row.installmentNo}</td>
                                  <td style={styles.td}>{row.disbursementDate}</td>
                                  <td style={styles.td}>{row.dueDate}</td>
                                  <td style={styles.td}>{row.daysInPeriod}</td>
                                  <td style={styles.td}>{fmtRupee(row.openingBalance)}</td>
                                  <td style={styles.td}><strong>{fmtRupee(row.emi)}</strong></td>
                                  <td style={styles.td}>{fmtRupee(row.principalPaid)}</td>
                                  <td style={styles.td}>{fmtRupee(row.interestPaid)}</td>
                                  <td style={styles.td}>{fmtRupee(row.closingBalance)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const styles = {
  pageContainer: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0px',
    boxSizing: 'border-box'
  },
  loginSplitCard: {
    background: 'rgba(255, 255, 255, 0.9)',
    backdropFilter: 'blur(10px)',
    borderRadius: '16px',
    boxShadow: '0 20px 40px rgba(0, 0, 0, 0.08)',
    width: '100%',
    maxWidth: '850px',
    display: 'flex',
    overflow: 'hidden',
    border: '1px solid rgba(255, 255, 255, 0.8)',
    margin: '20px'
  },
  loginBrandSection: {
    flex: '1',
    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.08) 100%)',
    padding: '50px 40px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'flex-start',
    borderRight: '1px solid #e2e8f0'
  },
  logoImageLeft: {
    width: '450x',
    height: '250px',
    marginBottom: '12px',
    objectFit: 'contain'
  },
  logoImageNavbar: {
    width: '100px',
    height: '100px',
    objectFit: 'contain'
  },
  navbarLeftGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px'
  },
  loginHeroTitle: {
    margin: '0 0 12px 0',
    color: '#1e3a8a',
    fontSize: '24px',
    fontWeight: '800',
    lineHeight: '1.2'
  },
  loginHeroSubtitle: {
    margin: 0,
    color: '#475569',
    fontSize: '14px',
    lineHeight: '1.5'
  },
  loginFormSection: {
    flex: '1.2',
    padding: '40px',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center'
  },
  headerSection: {
    marginBottom: '24px'
  },
  title: {
    margin: '0 0 6px 0',
    color: '#1e293b',
    fontSize: '20px',
    fontWeight: '700'
  },
  subtitle: {
    margin: 0,
    color: '#64748b',
    fontSize: '13px'
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  label: {
    fontSize: '12px',
    fontWeight: '600',
    color: '#334155'
  },
  input: {
    padding: '9px 12px',
    borderRadius: '6px',
    border: '1px solid #cbd5e1',
    fontSize: '13px',
    outline: 'none',
    transition: 'border-color 0.2s',
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: '#f8fafc'
  },
  inlineError: {
    color: '#dc2626',
    fontSize: '11px',
    marginTop: '2px'
  },
  captchaContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    background: '#f1f5f9',
    padding: '12px',
    borderRadius: '6px',
    border: '1px solid #cbd5e1'
  },
  captchaVisual: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    background: '#cbd5e1',
    backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)',
    backgroundSize: '10px 10px',
    padding: '10px 14px',
    borderRadius: '4px'
  },
  captchaTextDisplay: {
    fontSize: '20px',
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: '4px',
    textDecoration: 'line-through',
    fontStyle: 'italic',
    userSelect: 'none'
  },
  refreshBtn: {
    background: '#ffffff',
    border: '1px solid #94a3b8',
    padding: '4px 8px',
    color: '#1e293b',
    fontSize: '11px',
    cursor: 'pointer',
    borderRadius: '4px',
    fontWeight: '600'
  },
  errorBanner: {
    background: '#fee2e2',
    color: '#991b1b',
    padding: '10px',
    borderRadius: '6px',
    fontSize: '13px',
    textAlign: 'center',
    fontWeight: '500',
    marginBottom: '10px',
    border: '1px solid #fecaca'
  },
  successBanner: {
    background: '#dcfce7',
    color: '#166534',
    padding: '12px 16px',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: '600',
    marginBottom: '20px',
    border: '1px solid #bbf7d0'
  },
  primaryButton: {
    background: '#1d4ed8',
    color: '#ffffff',
    padding: '10px',
    borderRadius: '6px',
    border: 'none',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '4px',
    transition: 'background 0.2s'
  },
  pdfExportButton: {
    background: '#16a34a',
    color: '#ffffff',
    border: 'none',
    padding: '6px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '600'
  },
  closeAppButton: {
    background: '#dc2626',
    color: '#ffffff',
    border: 'none',
    padding: '11px 20px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600'
  },
  appLayout: {
    display: 'flex',
    width: '100vw',
    height: '100vh',
    backgroundColor: '#eef2f7'
  },
  sidebar: {
    width: '260px',
    backgroundColor: '#1e293b',
    color: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '4px 0 15px rgba(0,0,0,0.05)'
  },
  sidebarBrand: {
    padding: '24px 20px',
    borderBottom: '1px solid #334155',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  sidebarRole: {
    fontSize: '16px',
    color: '#f1f5f9',
    textTransform: 'uppercase',
    letterSpacing: '1px'
  },
  navLinks: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    padding: '20px 12px',
    flex: 1
  },
  navItem: {
    background: '#f1f5f9',
    border: 'none',
    color: '#94a3b8',
    textAlign: 'left',
    padding: '12px 16px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '500',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center'
  },
  activeNavItem: {
    backgroundColor: '#2563eb',
    color: '#ffffff'
  },
  sidebarFooter: {
    padding: '20px',
    borderTop: '1px solid #334155'
  },
  logoutButton: {
    background: '#dc2626',
    color: '#ffffff',
    border: 'none',
    padding: '10px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
    width: '100%'
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflowY: 'auto'
  },
  topNavbar: {
    background: '#ffffff',
    padding: '15px 30px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #cbd5e1',
    boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
  },
  pageHeading: {
    margin: 0,
    fontSize: '18px',
    color: '#1e293b',
    fontWeight: '700'
  },
  userProfileBadge: {
    fontSize: '14px',
    color: '#475569'
  },
  contentBody: {
    padding: '30px',
    flex: 1
  },
  welcomeSubtext: {
    margin: '0 0 24px 0',
    color: '#64748b',
    fontSize: '15px'
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '20px',
    marginBottom: '10px'
  },
  metricCard: {
    background: '#ffffff',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  subMetricCard: {
    background: '#f8fafc',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid #cbd5e1',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  subMetricLabel: {
    fontSize: '11px',
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase'
  },
  subMetricVal: {
    fontSize: '15px',
    fontWeight: '700',
    color: '#1e3a8a'
  },
  metricLabel: {
    fontSize: '13px',
    color: '#64748b',
    fontWeight: '600'
  },
  metricValue: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#0f172a'
  },
  metricValueBlue: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#2563eb'
  },
  metricValueOrange: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#d97706'
  },
  metricValueGreen: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#16a34a'
  },
  metricValueRed: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#dc2626'
  },
  cardSection: {
    background: '#ffffff',
    padding: '20px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    boxShadow: '0 2px 6px rgba(0,0,0,0.02)'
  },
  sectionTitle: {
    margin: '0 0 14px 0',
    fontSize: '15px',
    color: '#1e293b',
    fontWeight: '700'
  },
  formCardContainer: {
    background: '#ffffff',
    padding: '30px',
    borderRadius: '8px',
    border: '1px solid #cbd5e1',
    maxWidth: '700px',
    boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
    margin: '0 auto'
  },
  addFormGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px'
  },
  submitButton: {
    gridColumn: 'span 2',
    background: '#2563eb',
    color: '#ffffff',
    border: 'none',
    padding: '12px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    marginTop: '10px'
  },
  addNewInlineBtn: {
    backgroundColor: '#2563eb',
    color: '#ffffff',
    border: 'none',
    padding: '8px 14px',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'left',
    fontSize: '13px'
  },
  tableHeaderRow: {
    borderBottom: '2px solid #e2e8f0',
    color: '#475569',
    backgroundColor: '#f8fafc'
  },
  th: {
    padding: '10px 12px',
    fontWeight: '600'
  },
  tableRow: {
    borderBottom: '1px solid #e2e8f0',
    color: '#334155'
  },
  td: {
    padding: '11px 12px',
    verticalAlign: 'middle'
  },
  editButton: {
    backgroundColor: '#e2e8f0',
    color: '#1e293b',
    border: '1px solid #cbd5e1',
    padding: '6px 12px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  deleteButton: {
    backgroundColor: '#fee2e2',
    color: '#b91c1c',
    border: '1px solid #fecaca',
    padding: '6px 12px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  badgeActive: {
    background: '#dcfce7',
    color: '#15803d',
    padding: '4px 10px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '600'
  },
  badgeClosed: {
    background: '#fee2e2',
    color: '#b91c1c',
    padding: '4px 10px',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: '600'
  }
};

export default App;
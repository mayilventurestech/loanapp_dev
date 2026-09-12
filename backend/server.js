require("dotenv").config();
const express = require("express");
const cors = require("cors");

const loginRoutes = require("./routes/login");
const logoutRoutes = require("./routes/logout");
const customerRoutes = require("./routes/customers");
const loanRoutes = require("./routes/loans");
const loanApplicantRoutes = require("./routes/loanApplicants");
const branchRoutes = require("./routes/branches");
const employeeRoutes = require("./routes/employees");
const loanStatusHistoryRoutes = require("./routes/loanStatusHistory");
const loanRepaymentScheduleRoutes = require("./routes/loanRepaymentSchedule");
const paymentTransactionsRoutes = require("./routes/paymentTransactions");
const loanCollateralRoutes = require("./routes/loanCollateral");
const customerDocumentsRoutes = require("./routes/customerDocuments");
const customerCreditInfoRoutes = require("./routes/customerCreditInfo");
const loanApprovalRoutes = require("./routes/loanApproval");
const loanPenaltyRoutes = require("./routes/loanPenalty");
const appLogsRoutes = require("./routes/appLogs");
const verifyToken = require("./authMiddleware");
const watchActivity = require("./logMiddleware");

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  })
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "Loan App backend is running" });
});

app.use("/api/login", loginRoutes);
app.use("/api/logout", verifyToken, logoutRoutes);

app.use("/api/customers", verifyToken, watchActivity, customerRoutes);
app.use("/api/loans", verifyToken, watchActivity, loanRoutes);
app.use("/api/loan-applicants", verifyToken, watchActivity, loanApplicantRoutes);
app.use("/api/branches", verifyToken, watchActivity, branchRoutes);
app.use("/api/employees", verifyToken, watchActivity, employeeRoutes);
app.use("/api/loan-status-history", verifyToken, watchActivity, loanStatusHistoryRoutes);
app.use("/api/loan-repayment-schedule", verifyToken, watchActivity, loanRepaymentScheduleRoutes);
app.use("/api/payment-transactions", verifyToken, watchActivity, paymentTransactionsRoutes);
app.use("/api/loan-collateral", verifyToken, watchActivity, loanCollateralRoutes);
app.use("/api/customer-documents", verifyToken, watchActivity, customerDocumentsRoutes);
app.use("/api/customer-credit-info", verifyToken, watchActivity, customerCreditInfoRoutes);
app.use("/api/loan-approval", verifyToken, watchActivity, loanApprovalRoutes);
app.use("/api/loan-penalty", verifyToken, watchActivity, loanPenaltyRoutes);
app.use("/api/app-logs", verifyToken, appLogsRoutes);

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
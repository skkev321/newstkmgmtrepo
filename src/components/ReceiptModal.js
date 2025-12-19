// ReceiptModal.js
// Dark, minimal receipt layout
// Store name ONLY: "THE LEAF & ASH CO."
// No phone, no address, no footer text

const SHOP = {
  name: "THE LEAF & ASH CO.",
};

const PAGE = {
  width: 80,
  frameX: 4,
  frameY: 4,
  frameW: 72,
  padX: 10,
  rightX: 70,
};

function nowSL() {
  return new Date().toLocaleString("en-LK", {
    timeZone: "Asia/Colombo",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateSL(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-LK", {
      timeZone: "Asia/Colombo",
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function safeText(v) {
  return String(v ?? "");
}

function hasNumber(v) {
  return typeof v === "number" && !isNaN(v);
}

function formatLKR(n) {
  const x = Number(n || 0);
  const formatted = new Intl.NumberFormat("en-LK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(x);
  return `LKR ${formatted}`;
}

function truncate(doc, text, maxWidthMm) {
  const t = safeText(text);
  if (!t) return "";
  if (doc.getTextWidth(t) <= maxWidthMm) return t;

  let out = t;
  while (out.length && doc.getTextWidth(out + "…") > maxWidthMm) {
    out = out.slice(0, -1);
  }
  return out ? out + "…" : "";
}

function normalizeStatus(s) {
  const raw = safeText(s).trim().toLowerCase();
  if (!raw) return "";
  if (raw === "part_paid" || raw === "part paid" || raw === "partial") return "PART PAID";
  if (raw === "paid") return "PAID";
  if (raw === "issued") return "ISSUED";
  if (raw === "void" || raw === "cancelled" || raw === "canceled") return "VOID";
  return raw.toUpperCase().replaceAll("_", " ");
}

function createDoc(height) {
  const { jsPDF } = window.jspdf;
  const h = Math.max(Number(height || 170), 170);
  return new jsPDF({ orientation: "portrait", unit: "mm", format: [PAGE.width, h] });
}

function drawFrame(doc, h) {
  doc.setDrawColor(50);
  doc.setLineWidth(0.8);
  doc.rect(PAGE.frameX, PAGE.frameY, PAGE.frameW, h - 8);
}

function line(doc, y, thick) {
  doc.setDrawColor(200);
  doc.setLineWidth(thick ? 0.6 : 0.25);
  doc.line(PAGE.padX, y, PAGE.rightX, y);
}

function dottedLine(doc, y) {
  doc.setDrawColor(210);
  doc.setLineWidth(0.25);
  for (let x = PAGE.padX; x < PAGE.rightX; x += 2) {
    doc.line(x, y, x + 0.8, y);
  }
}

function drawHeader(doc, title, subtitle, continued) {
  let y = 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(truncate(doc, SHOP.name, 60), PAGE.padX, y);
  y += 6;

  line(doc, y, true);
  y += 6;

  doc.setFontSize(10);
  doc.text(title, PAGE.padX, y);
  y += 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(`Generated: ${nowSL()}`, PAGE.padX, y);
  y += 4;

  if (continued) {
    doc.setFont("helvetica", "bold");
    doc.text("--- Continued ---", PAGE.padX, y);
    doc.setFont("helvetica", "normal");
    y += 4;
  }

  dottedLine(doc, y);
  return y + 5;
}

function ensureSpace(doc, y, need, state) {
  if (y + need <= state.h - 10) return y;

  doc.addPage([PAGE.width, state.h], "portrait");
  drawFrame(doc, state.h);
  state.y = drawHeader(doc, state.title, state.subtitle, true);
  return state.y;
}

function drawKeyValue(doc, y, label, value, bold) {
  doc.setFont("helvetica", bold ? "bold" : "normal");
  doc.setFontSize(9);
  doc.text(label, PAGE.padX, y);

  doc.setFont("helvetica", "bold");
  doc.text(value, PAGE.rightX, y, { align: "right" });
  return y + 5;
}

function drawBadge(doc, status, y) {
  const text = normalizeStatus(status);
  if (!text) return;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);

  const pad = 1.4;
  const w = doc.getTextWidth(text) + pad * 2;
  const h = 4.6;
  const x = PAGE.rightX - w;
  const yTop = y - h + 1;

  doc.setDrawColor(80);
  doc.setLineWidth(0.3);
  doc.roundedRect(x, yTop, w, h, 1.5, 1.5, "S");
  doc.text(text, x + pad, y);
}

function estimateHeight(invoices) {
  let h = 95;
  invoices.forEach((inv) => {
    h += 30;
    h += Math.min((inv.lines || []).length, 50) * 9;
    h += 8;
  });
  return h;
}

function calcTotals(invoices) {
  let totalDue = 0;
  let totalInvoiced = 0;
  let totalPaid = 0;

  invoices.forEach((inv) => {
    const due = Number(inv.balance_due || 0);
    const total = Number(inv.total || 0);
    const paid = hasNumber(inv.paid_amount) ? inv.paid_amount : Math.max(0, total - due);
    totalDue += due;
    totalInvoiced += total;
    totalPaid += paid;
  });

  return { totalDue, totalInvoiced, totalPaid, count: invoices.length };
}

function drawInvoice(doc, inv, y, state, kind) {
  const due = Number(inv.balance_due || 0);
  const total = Number(inv.total || 0);
  const paid = hasNumber(inv.paid_amount) ? inv.paid_amount : Math.max(0, total - due);

  y = ensureSpace(doc, y, 24, state);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(
    truncate(doc, `${inv.invoice_no} (${formatDateSL(inv.invoice_date)})`, 40),
    PAGE.padX,
    y
  );
  drawBadge(doc, inv.status, y);
  y += 5;

  y = drawKeyValue(doc, y, "Total", formatLKR(total), false);

  if (paid > 0 || normalizeStatus(inv.status) === "PART PAID") {
    const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
    y = drawKeyValue(doc, y, "Paid", `${formatLKR(paid)}${pct ? ` (${pct}%)` : ""}`, false);
  }

  y = drawKeyValue(doc, y, "Due", formatLKR(due), true);

  (inv.lines || []).slice(0, 50).forEach((ln) => {
    y = ensureSpace(doc, y, 10, state);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(truncate(doc, ln.bundle_name || "", 58), PAGE.padX, y);
    y += 4;

    const qty = kind === "supplier" ? ln.bundles_qty : ln.packs_qty;
    const unit =
      kind === "supplier" ? ln.unit_cost_per_bundle : ln.unit_price;

    doc.text(`${qty || 0} x ${Number(unit || 0).toFixed(2)}`, PAGE.padX, y);
    doc.setFont("helvetica", "bold");
    doc.text(
      Number(ln.line_total || 0).toFixed(2),
      PAGE.rightX,
      y,
      { align: "right" }
    );
    y += 5;
  });

  dottedLine(doc, y);
  return y + 6;
}

/* ================= CUSTOMER ================= */

export function generateCustomerOutstandingReceipt(customerName, invoices) {
  const invs = Array.isArray(invoices) ? invoices : [];
  const totals = calcTotals(invs);

  const doc = createDoc(estimateHeight(invs));
  const state = {
    h: doc.internal.pageSize.getHeight(),
    title: "Customer Outstanding",
    subtitle: `Customer: ${safeText(customerName)}`,
    y: 0,
  };

  drawFrame(doc, state.h);
  let y = drawHeader(doc, state.title, state.subtitle, false);

  y = drawKeyValue(doc, y, "Invoices", `${totals.count}`, false);
  y = drawKeyValue(doc, y, "Total Invoiced", formatLKR(totals.totalInvoiced), false);
  if (totals.totalPaid > 0) {
    y = drawKeyValue(doc, y, "Total Paid", formatLKR(totals.totalPaid), false);
  }
  y = drawKeyValue(doc, y, "Total Outstanding", formatLKR(totals.totalDue), true);

  line(doc, y, true);
  y += 6;

  invs.forEach((inv) => {
    y = drawInvoice(doc, inv, y, state, "customer");
  });

  doc.save(
    `customer-outstanding-${safeText(customerName).replace(/[^\w-]+/g, "-")}.pdf`
  );
}

/* ================= SUPPLIER ================= */

export function generateSupplierOutstandingReceipt(supplierName, invoices) {
  const invs = Array.isArray(invoices) ? invoices : [];
  const totals = calcTotals(invs);

  const doc = createDoc(estimateHeight(invs));
  const state = {
    h: doc.internal.pageSize.getHeight(),
    title: "Supplier Outstanding",
    subtitle: `Supplier: ${safeText(supplierName)}`,
    y: 0,
  };

  drawFrame(doc, state.h);
  let y = drawHeader(doc, state.title, state.subtitle, false);

  y = drawKeyValue(doc, y, "Invoices", `${totals.count}`, false);
  y = drawKeyValue(doc, y, "Total Invoiced", formatLKR(totals.totalInvoiced), false);
  if (totals.totalPaid > 0) {
    y = drawKeyValue(doc, y, "Total Paid", formatLKR(totals.totalPaid), false);
  }
  y = drawKeyValue(doc, y, "Total Outstanding", formatLKR(totals.totalDue), true);

  line(doc, y, true);
  y += 6;

  invs.forEach((inv) => {
    y = drawInvoice(doc, inv, y, state, "supplier");
  });

  doc.save(
    `supplier-outstanding-${safeText(supplierName).replace(/[^\w-]+/g, "-")}.pdf`
  );
}

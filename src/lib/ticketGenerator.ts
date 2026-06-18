import { pinyin } from 'pinyin-pro';

if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x: number, y: number, w: number, h: number, r: number) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    this.beginPath();
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

export interface TicketParams {
  canvas: HTMLCanvasElement;
  qrEl: HTMLCanvasElement | null;
  ticketCode: string;
  sessionName: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  verificationStart?: string | null;
  verificationEnd?: string | null;
  name: string;
  seatName?: string;
  ticketType?: 'adult' | 'child' | 'concession';
  operatorName: string;
  orderTime: string;
  isSupplementary?: boolean;
  isReprint?: boolean;
  orderStatus?: string;
  ticketPrice?: number;
  serviceFee?: number;
  paidAt?: string;
  printedAt?: string;
  paymentMethod?: 'rmb' | 'lcoin' | 'mixed';
  rmbAmount?: number;
}

function toCnPinyin(text: string): string {
  if (!text) return text;
  if (!/[\u4e00-\u9fff]/.test(text)) return text;
  const result = pinyin(text, { toneType: 'none', nonZh: 'consecutive' });
  const joined = result.replace(/ +/g, '');
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

function seatToEnglish(seat: string): string {
  const m = seat.match(/^([A-Z])排(\d+)座$/);
  if (!m) return seat;
  return `Row ${m[1]}, Seat ${m[2]}`;
}

export function renderTicketToCanvas(p: TicketParams): void {
  const D = 2;
  const W = 651 * D;
  const PAD = 34 * D;
  const QR_SIZE = 260 * D;
  const VALUE_X = PAD + 150 * D;

  const LABEL_SIZE = 22 * D;
  const EN_LABEL_SIZE = 22 * D;
  const VALUE_SIZE = 28 * D;
  const EN_VALUE_SIZE = 26 * D;
  const ROW_HEIGHT = 72 * D;

  const LABEL_COLOR = '#5c4a3a';
  const LABEL_COLOR_EN = '#9b8b7b';
  const VALUE_COLOR = '#0f172a';
  const VALUE_COLOR_EN = '#374151';

  const activityTimeCn = `${p.sessionDate} ${p.startTime.slice(0, 5)} – ${p.endTime.slice(0, 5)}`;
  const activityTimeEn = activityTimeCn;

  const verifStart = p.verificationStart ? p.verificationStart.slice(0, 5) : '';
  const verifEnd = p.verificationEnd ? p.verificationEnd.slice(0, 5) : '';
  const verifRange = verifStart && verifEnd
    ? `${p.sessionDate} ${verifStart} – ${verifEnd}`
    : '';

  const nameEn = toCnPinyin(p.name);
  const operatorCn = `前台客服 (工号: ${p.operatorName})`;
  const operatorEn = `Front Desk Service (Staff ID: ${p.operatorName})`;
  const seatEn = p.seatName ? seatToEnglish(p.seatName) : '';
  const sessionNameEn = toCnPinyin(p.sessionName);

  const ticketTypeCn: Record<string, string> = { adult: '成人票', child: '儿童票', concession: '优待票' };
  const ticketTypeEn: Record<string, string> = { adult: 'Adult', child: 'Child', concession: 'Concession' };
  const ticketTypeColor: Record<string, string> = { adult: '#0ea5e9', child: '#10b981', concession: '#f59e0b' };

  let subLabelCn = '活动入场券';
  let subLabelEn = 'Event Admission Ticket';
  if (p.orderStatus === 'cancelled' || p.orderStatus === 'expired') {
    subLabelCn = '活动预订证明';
    subLabelEn = 'Event Booking Proof';
  } else if (p.orderStatus === 'used') {
    subLabelCn = '活动入场证明';
    subLabelEn = 'Event Admission Proof';
  }

  const paymentMethod = p.paymentMethod || 'rmb';
  const getCurrencyInfo = () => {
    switch (paymentMethod) {
      case 'lcoin': return { symbol: '', cnUnit: '兰克币', enUnit: 'LC' };
      case 'mixed': return { symbol: '', cnUnit: '兰克币', enUnit: 'LC' };
      default: return { symbol: '¥', cnUnit: '', enUnit: '' };
    }
  };
  const currency = getCurrencyInfo();
  const totalAmount = (p.ticketPrice ?? 0) + (p.serviceFee ?? 0);
  const mixedRmbInfo = paymentMethod === 'mixed' && p.rmbAmount !== undefined && p.rmbAmount > 0
    ? ` (人民币支付 ¥${p.rmbAmount.toFixed(2)})`
    : '';

  const hasPrice = p.ticketPrice !== undefined;
  const hasFee = p.serviceFee !== undefined && p.serviceFee > 0;
  const hasTotal = hasPrice;

  const rows = [
    { cn: '活动时间', en: 'Event Time', cnVal: activityTimeCn, enVal: activityTimeEn },
    ...(verifRange ? [{ cn: '核销时间', en: 'Check-in Time', cnVal: verifRange, enVal: verifRange }] : []),
    { cn: '用户名', en: 'Username', cnVal: p.name, enVal: nameEn },
    ...(p.seatName ? [{ cn: '座位', en: 'Seat', cnVal: p.seatName, enVal: seatEn }] : []),
    ...(p.ticketType ? [{ cn: '票种', en: 'Ticket Type', cnVal: ticketTypeCn[p.ticketType], enVal: ticketTypeEn[p.ticketType], color: ticketTypeColor[p.ticketType] }] : []),
    { cn: '操作员', en: 'Operator', cnVal: operatorCn, enVal: operatorEn },
    { cn: '下单时间', en: 'Order Time', cnVal: p.orderTime, enVal: p.orderTime },
    ...(hasPrice ? [{ type: 'price' }] : []),
    ...(hasTotal ? [{ type: 'total' }] : []),
    ...(p.paidAt ? [{ cn: '付款时间', en: 'Payment Time', cnVal: p.paidAt, enVal: p.paidAt }] : []),
    ...(p.printedAt ? [{ cn: '打印时间', en: 'Print Time', cnVal: p.printedAt, enVal: p.printedAt }] : []),
  ];

  const HEADER_H = 120 * D;
  const DATA_START_Y = HEADER_H + 20 * D;
  const DATA_H = rows.length * ROW_HEIGHT;
  const PERF_Y = DATA_START_Y + DATA_H;
  const QR_Y = PERF_Y + 30 * D;
  const FOOTER_H = 260 * D;
  const H = QR_Y + QR_SIZE + FOOTER_H;

  p.canvas.width = W;
  p.canvas.height = H;
  const ctx = p.canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#0ea5e9');
  grad.addColorStop(1, '#06b6d4');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 11 * D);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5 * D;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // ── Badges ───────────────────────────────────────────────────────────
  function drawBadge(label: string, color: string) {
    ctx.font = `bold ${26 * D}px sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const paddingX = 18 * D;
    const paddingY = 8 * D;
    const BW = textWidth + paddingX * 2;
    const BH = 26 * D + paddingY * 2;
    const BX = W - PAD - BW - 8 * D;
    const BY = 22 * D;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(BX, BY, BW, BH, 12 * D);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, BX + BW / 2, BY + BH / 2);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }
  if (p.isReprint) drawBadge('补打小票', '#dc2626');
  if (p.isSupplementary) drawBadge('补票', '#f97316');

  // ── Header ───────────────────────────────────────────────────────────
  ctx.textBaseline = 'bottom';
  
  ctx.font = `bold ${36 * D}px sans-serif`;
  ctx.fillStyle = '#0f172a';
  ctx.fillText(p.sessionName, PAD, 80 * D);

  ctx.font = `bold ${24 * D}px sans-serif`;
  ctx.fillText(sessionNameEn, PAD, 110 * D);

  ctx.font = `${20 * D}px sans-serif`;
  ctx.fillStyle = '#0ea5e9';
  ctx.textAlign = 'right';
  ctx.fillText(subLabelCn, W - PAD, 80 * D);

  ctx.font = `${18 * D}px sans-serif`;
  ctx.fillText(subLabelEn, W - PAD, 110 * D);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // ── Divider ──────────────────────────────────────────────────────────
  ctx.setLineDash([12 * D, 4 * D]);
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 4 * D;
  ctx.beginPath();
  ctx.moveTo(PAD, HEADER_H);
  ctx.lineTo(W - PAD, HEADER_H);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Draw standard row ────────────────────────────────────────────────
  function drawRow(cnLabel: string, enLabel: string, cnValue: string, enValue: string, y: number, color?: string) {
    const textColor = color ?? VALUE_COLOR;
    const enTextColor = color === undefined ? VALUE_COLOR_EN : color;

    ctx.fillStyle = LABEL_COLOR;
    ctx.font = `${LABEL_SIZE}px sans-serif`;
    ctx.fillText(cnLabel, PAD, y);

    ctx.fillStyle = LABEL_COLOR_EN;
    ctx.font = `${EN_LABEL_SIZE}px sans-serif`;
    ctx.fillText(enLabel, PAD, y + 24 * D);

    ctx.fillStyle = textColor;
    ctx.font = `${VALUE_SIZE}px sans-serif`;
    ctx.fillText(cnValue, VALUE_X, y);

    if (cnValue !== enValue) {
      ctx.fillStyle = enTextColor;
      ctx.font = `${EN_VALUE_SIZE}px sans-serif`;
      ctx.fillText(enValue, VALUE_X, y + 24 * D);
    }
  }

  // ── Draw price/fee row ────────────────────────────────────────────────
  function drawPriceFeeRow(y: number) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = `${LABEL_SIZE}px sans-serif`;
    ctx.fillText('票价', PAD, y);

    ctx.fillStyle = LABEL_COLOR_EN;
    ctx.font = `${EN_LABEL_SIZE}px sans-serif`;
    ctx.fillText('Ticket Price', PAD, y + 24 * D);

    ctx.fillStyle = VALUE_COLOR;
    ctx.font = `${VALUE_SIZE}px sans-serif`;
    const priceValue = p.ticketPrice !== undefined
      ? `${currency.symbol}${p.ticketPrice.toFixed(2)}${currency.cnUnit ? `/${p.ticketPrice.toFixed(2)}${currency.cnUnit}` : ''}`
      : '';
    ctx.fillText(priceValue, VALUE_X, y);

    if (hasFee) {
      const feeLabelX = W - PAD - 150 * D;
      
      ctx.fillStyle = LABEL_COLOR;
      ctx.font = `${LABEL_SIZE}px sans-serif`;
      ctx.fillText('手续费', feeLabelX, y);

      ctx.fillStyle = LABEL_COLOR_EN;
      ctx.font = `${EN_LABEL_SIZE}px sans-serif`;
      ctx.fillText('Service Fee', feeLabelX, y + 24 * D);

      ctx.fillStyle = VALUE_COLOR;
      ctx.font = `${VALUE_SIZE}px sans-serif`;
      ctx.textAlign = 'right';
      const feeValue = `${currency.symbol}${p.serviceFee!.toFixed(2)}${currency.cnUnit ? `/${p.serviceFee!.toFixed(2)}${currency.cnUnit}` : ''}`;
      ctx.fillText(feeValue, W - PAD, y);
      ctx.textAlign = 'left';
    }
  }

  // ── Draw total row ────────────────────────────────────────────────────
  function drawTotalRow(y: number) {
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = `${LABEL_SIZE}px sans-serif`;
    ctx.fillText('合计', PAD, y);

    ctx.fillStyle = LABEL_COLOR_EN;
    ctx.font = `${EN_LABEL_SIZE}px sans-serif`;
    ctx.fillText('Total', PAD, y + 24 * D);

    ctx.fillStyle = VALUE_COLOR;
    ctx.font = `${VALUE_SIZE}px sans-serif`;
    const totalValue = `${currency.symbol}${totalAmount.toFixed(2)}${currency.cnUnit ? `/${totalAmount.toFixed(2)}${currency.cnUnit}` : ''}${mixedRmbInfo}`;
    ctx.fillText(totalValue, VALUE_X, y);
  }

  // ── Data rows ─────────────────────────────────────────────────────────
  let iy = DATA_START_Y;
  for (const row of rows) {
    if (row.type === 'price') {
      drawPriceFeeRow(iy);
    } else if (row.type === 'total') {
      drawTotalRow(iy);
    } else {
      drawRow(row.cn!, row.en!, row.cnVal!, row.enVal!, iy, row.color);
    }
    iy += ROW_HEIGHT;
  }

  // ── Perforation ──────────────────────────────────────────────────────
  ctx.setLineDash([12 * D, 4 * D]);
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 4 * D;
  ctx.beginPath();
  ctx.moveTo(PAD, PERF_Y);
  ctx.lineTo(W - PAD, PERF_Y);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── QR code ──────────────────────────────────────────────────────────
  const qrX = (W - QR_SIZE) / 2;
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.roundRect(qrX - 12 * D, QR_Y - 12 * D, QR_SIZE + 24 * D, QR_SIZE + 24 * D, 14 * D);
  ctx.fill();
  if (p.qrEl) {
    ctx.drawImage(p.qrEl, qrX, QR_Y, QR_SIZE, QR_SIZE);
  } else {
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(qrX, QR_Y, QR_SIZE, QR_SIZE);
  }

  // ── Footer ────────────────────────────────────────────────────────────
  ctx.textAlign = 'center';
  const fBase = QR_Y + QR_SIZE;

  ctx.fillStyle = '#0369a1';
  ctx.font = `bold ${28 * D}px monospace`;
  ctx.fillText(p.ticketCode, W / 2, fBase + 28 * D);

  ctx.fillStyle = '#78716c';
  ctx.font = `${18 * D}px sans-serif`;
  ctx.fillText('入场时出示二维码供工作人员核销', W / 2, fBase + 52 * D);

  ctx.fillStyle = '#a8a29e';
  ctx.font = `${18 * D}px sans-serif`;
  ctx.fillText('Present QR code at entrance for staff verification', W / 2, fBase + 72 * D);

  ctx.fillStyle = '#0284c7';
  ctx.font = `${20 * D}px sans-serif`;
  ctx.fillText('https://lankegroup-booking.netlify.app/', W / 2, fBase + 98 * D);

  ctx.fillStyle = '#a8a29e';
  ctx.font = `${12 * D}px sans-serif`;
  ctx.fillText('© 兰克集团数智一体化票务运营平台版权所有', W / 2, fBase + 120 * D);

  ctx.fillStyle = '#a8a29e';
  ctx.font = `${12 * D}px sans-serif`;
  ctx.fillText('Copyright © Lanke Group Digital Integrated Ticketing Platform. All Rights Reserved.', W / 2, fBase + 144 * D);

  ctx.textAlign = 'left';
}

export function formatOrderTime(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function downloadTicket(canvas: HTMLCanvasElement, ticketCode: string): void {
  const link = document.createElement('a');
  link.download = `ticket-${ticketCode}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

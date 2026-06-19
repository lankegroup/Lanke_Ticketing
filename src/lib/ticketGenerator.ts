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
  const PAD = 30 * D;

  const ctx = p.canvas.getContext('2d')!;

  const sessionNameEn = toCnPinyin(p.sessionName);
  const nameEn = toCnPinyin(p.name);
  const seatEn = p.seatName ? seatToEnglish(p.seatName) : '';

  const activityTime = `${p.sessionDate} ${p.startTime.slice(0, 5)} - ${p.endTime.slice(0, 5)}`;
  const verifStart = p.verificationStart ? p.verificationStart.slice(0, 5) : '';
  const verifEnd = p.verificationEnd ? p.verificationEnd.slice(0, 5) : '';
  const verifRange = verifStart && verifEnd
    ? `${p.sessionDate} ${verifStart} - ${verifEnd}`
    : '';

  const ticketTypeCn: Record<string, string> = { adult: '成人票', child: '儿童票', concession: '优待票' };
  const ticketTypeEn: Record<string, string> = { adult: 'Adult', child: 'Child', concession: 'Concession' };

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

  const QR_SIZE = 240 * D;
  
  const HEADER_H = 140 * D;
  const INFO_H = 380 * D;
  const QR_H = QR_SIZE + 80 * D;
  const FOOTER_H = 160 * D;
  const H = HEADER_H + INFO_H + QR_H + FOOTER_H;

  p.canvas.width = W;
  p.canvas.height = H;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5 * D;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  // ── Brand Header ───────────────────────────────────────────────────────
  const brandGrad = ctx.createLinearGradient(0, 0, W, 0);
  brandGrad.addColorStop(0, '#1e40af');
  brandGrad.addColorStop(1, '#3b82f6');
  ctx.fillStyle = brandGrad;
  ctx.fillRect(0, 0, W, 45 * D);

  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${24 * D}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('LANKE GROUP TICKETING', W / 2, 22 * D);

  // ── Badges ────────────────────────────────────────────────────────────
  function drawBadge(label: string, color: string, y: number) {
    ctx.font = `bold ${20 * D}px sans-serif`;
    const textWidth = ctx.measureText(label).width;
    const paddingX = 14 * D;
    const paddingY = 6 * D;
    const BW = textWidth + paddingX * 2;
    const BH = 20 * D + paddingY * 2;
    const BX = W - PAD - BW;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(BX, y, BW, BH, 8 * D);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, BX + BW / 2, y + BH / 2);
    ctx.textAlign = 'left';
  }

  let badgeY = 55 * D;
  if (p.isReprint) {
    drawBadge('补打小票', '#dc2626', badgeY);
    badgeY += 36 * D;
  }
  if (p.isSupplementary) {
    drawBadge('补票', '#f97316', badgeY);
    badgeY += 36 * D;
  }

  // ── Session Title ──────────────────────────────────────────────────────
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  ctx.font = `bold ${42 * D}px sans-serif`;
  ctx.fillStyle = '#1e293b';
  ctx.fillText(p.sessionName, PAD, 75 * D);

  ctx.font = `bold ${22 * D}px sans-serif`;
  ctx.fillStyle = '#64748b';
  ctx.fillText(sessionNameEn, PAD, 105 * D);

  ctx.font = `${18 * D}px sans-serif`;
  ctx.fillStyle = '#3b82f6';
  ctx.textAlign = 'right';
  ctx.fillText('活动入场券 / Event Admission Ticket', W - PAD, 75 * D);
  ctx.textAlign = 'left';

  // ── Header Divider ────────────────────────────────────────────────────
  ctx.setLineDash([10 * D, 4 * D]);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2 * D;
  ctx.beginPath();
  ctx.moveTo(PAD, HEADER_H);
  ctx.lineTo(W - PAD, HEADER_H);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Info Section ──────────────────────────────────────────────────────
  const infoStart = HEADER_H + 20 * D;
  const col1Width = W / 2;
  const col2Width = W / 2;

  function drawInfoLine(cnLabel: string, enLabel: string, value: string, y: number) {
    ctx.font = `${18 * D}px sans-serif`;
    ctx.fillStyle = '#64748b';
    ctx.fillText(cnLabel, PAD, y);
    
    ctx.font = `${16 * D}px sans-serif`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(enLabel, PAD, y + 22 * D);

    ctx.font = `${20 * D}px sans-serif`;
    ctx.fillStyle = '#1e293b';
    ctx.fillText(value, PAD + 120 * D, y);
  }

  let iy = infoStart;

  drawInfoLine('活动时间', 'Event Time', activityTime, iy);
  iy += 55 * D;

  if (verifRange) {
    drawInfoLine('核销时间', 'Check-in Time', verifRange, iy);
    iy += 55 * D;
  }

  drawInfoLine('用户名', 'Username', p.name + (nameEn !== p.name ? ` / ${nameEn}` : ''), iy);
  iy += 55 * D;

  if (p.seatName) {
    drawInfoLine('座位', 'Seat', p.seatName + (seatEn !== p.seatName ? ` / ${seatEn}` : ''), iy);
    iy += 55 * D;
  }

  if (p.ticketType) {
    ctx.font = `${18 * D}px sans-serif`;
    ctx.fillStyle = '#64748b';
    ctx.fillText('票种', PAD, iy);
    
    ctx.font = `${16 * D}px sans-serif`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Ticket Type', PAD, iy + 22 * D);

    ctx.font = `bold ${22 * D}px sans-serif`;
    ctx.fillStyle = '#0ea5e9';
    ctx.fillText(ticketTypeCn[p.ticketType] + ' / ' + ticketTypeEn[p.ticketType], PAD + 120 * D, iy);
    iy += 55 * D;
  }

  drawInfoLine('操作员', 'Operator', `前台客服 (ID: ${p.operatorName})`, iy);
  iy += 55 * D;

  // ── Price Section ─────────────────────────────────────────────────────
  iy += 10 * D;
  ctx.setLineDash([8 * D, 3 * D]);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1.5 * D;
  ctx.beginPath();
  ctx.moveTo(PAD, iy);
  ctx.lineTo(W - PAD, iy);
  ctx.stroke();
  ctx.setLineDash([]);
  iy += 20 * D;

  ctx.font = `bold ${20 * D}px sans-serif`;
  ctx.fillStyle = '#475569';
  ctx.fillText('票价', PAD, iy);
  
  ctx.font = `${16 * D}px sans-serif`;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('Ticket Price', PAD, iy + 20 * D);

  ctx.font = `bold ${28 * D}px sans-serif`;
  ctx.fillStyle = '#1e293b';
  const priceText = p.ticketPrice !== undefined
    ? `${currency.symbol}${p.ticketPrice.toFixed(2)}${currency.cnUnit ? ` ${currency.cnUnit}` : ''}`
    : '';
  ctx.fillText(priceText, PAD + 120 * D, iy);

  if (p.serviceFee !== undefined && p.serviceFee > 0) {
    ctx.font = `bold ${20 * D}px sans-serif`;
    ctx.fillStyle = '#475569';
    ctx.textAlign = 'right';
    ctx.fillText('手续费', W - PAD, iy);
    
    ctx.font = `${16 * D}px sans-serif`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('Service Fee', W - PAD, iy + 20 * D);

    ctx.font = `bold ${28 * D}px sans-serif`;
    ctx.fillStyle = '#1e293b';
    const feeText = `${currency.symbol}${p.serviceFee.toFixed(2)}${currency.cnUnit ? ` ${currency.cnUnit}` : ''}`;
    ctx.fillText(feeText, W - PAD, iy);
    ctx.textAlign = 'left';
  }

  iy += 55 * D;

  ctx.font = `bold ${22 * D}px sans-serif`;
  ctx.fillStyle = '#1e40af';
  ctx.fillText('合计', PAD, iy);
  
  ctx.font = `${16 * D}px sans-serif`;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('Total', PAD, iy + 20 * D);

  ctx.font = `bold ${32 * D}px sans-serif`;
  ctx.fillStyle = '#dc2626';
  const totalText = `${currency.symbol}${totalAmount.toFixed(2)}${currency.cnUnit ? ` ${currency.cnUnit}` : ''}`;
  ctx.textAlign = 'right';
  ctx.fillText(totalText, W - PAD, iy);
  ctx.textAlign = 'left';

  iy += 50 * D;

  if (p.orderTime) {
    ctx.font = `${16 * D}px sans-serif`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`下单时间 / Order Time: ${p.orderTime}`, PAD, iy);
  }

  if (p.paidAt) {
    iy += 25 * D;
    ctx.font = `${16 * D}px sans-serif`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`付款时间 / Payment Time: ${p.paidAt}`, PAD, iy);
  }

  if (p.printedAt) {
    iy += 25 * D;
    ctx.font = `${16 * D}px sans-serif`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`打印时间 / Print Time: ${p.printedAt}`, PAD, iy);
  }

  // ── Perforation Line ──────────────────────────────────────────────────
  const perfY = HEADER_H + INFO_H;
  ctx.setLineDash([15 * D, 5 * D]);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 3 * D;
  ctx.beginPath();
  ctx.moveTo(PAD, perfY);
  ctx.lineTo(W - PAD, perfY);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── QR Code Section ───────────────────────────────────────────────────
  const qrX = (W - QR_SIZE) / 2;
  const qrY = perfY + 30 * D;

  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.roundRect(qrX - 15 * D, qrY - 15 * D, QR_SIZE + 30 * D, QR_SIZE + 30 * D, 16 * D);
  ctx.fill();

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1 * D;
  ctx.stroke();

  if (p.qrEl) {
    ctx.drawImage(p.qrEl, qrX, qrY, QR_SIZE, QR_SIZE);
  } else {
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(qrX, qrY, QR_SIZE, QR_SIZE);
  }

  // ── Ticket Code ───────────────────────────────────────────────────────
  ctx.font = `bold ${30 * D}px monospace`;
  ctx.fillStyle = '#1e40af';
  ctx.textAlign = 'center';
  ctx.fillText(p.ticketCode, W / 2, qrY + QR_SIZE + 45 * D);

  // ── Footer ────────────────────────────────────────────────────────────
  const footerStart = qrY + QR_SIZE + 70 * D;

  ctx.font = `${16 * D}px sans-serif`;
  ctx.fillStyle = '#64748b';
  ctx.fillText('入场时出示此二维码供工作人员核销', W / 2, footerStart);

  ctx.font = `${14 * D}px sans-serif`;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('Present QR code at entrance for staff verification', W / 2, footerStart + 22 * D);

  ctx.font = `${14 * D}px sans-serif`;
  ctx.fillStyle = '#3b82f6';
  ctx.fillText('https://lankegroup-booking.netlify.app/', W / 2, footerStart + 48 * D);

  ctx.font = `${12 * D}px sans-serif`;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('© 兰克集团数智一体化票务运营平台版权所有', W / 2, footerStart + 75 * D);

  ctx.font = `${12 * D}px sans-serif`;
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('Copyright © Lanke Group Digital Integrated Ticketing Platform. All Rights Reserved.', W / 2, footerStart + 95 * D);

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
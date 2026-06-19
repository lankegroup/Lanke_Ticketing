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
  purchaseChannel?: 'online' | 'offline';
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

function hasChinese(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

export function renderTicketToCanvas(p: TicketParams): void {
  const D = 2;
  const W = 400 * D;
  const PAD = 15 * D;
  const LINE_HEIGHT = 1.5;

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
  const isMixedPayment = paymentMethod === 'mixed';
  const rmbPaidAmount = p.rmbAmount || 0;

  const currencySymbol = paymentMethod === 'rmb' ? 'RMB' : 'LC';
  const totalAmount = (p.ticketPrice ?? 0) + (p.serviceFee ?? 0);

  const QR_SIZE = 180 * D;

  const HEADER_H = 80 * D;
  const TITLE_H = 60 * D;
  const INFO_START = HEADER_H + TITLE_H + 20 * D;

  const rows: { cnLabel?: string; enLabel?: string; cnValue?: string; enValue?: string; valueOnly?: string; isDivider?: boolean }[] = [
    { cnLabel: '活动时间', enLabel: 'Event Time', cnValue: activityTime },
    ...(verifRange ? [{ cnLabel: '核销时间', enLabel: 'Check-in', cnValue: verifRange }] : []),
    { cnLabel: '用户名', enLabel: 'User', cnValue: p.name, enValue: nameEn !== p.name ? nameEn : undefined },
    ...(p.seatName ? [{ cnLabel: '座位', enLabel: 'Seat', cnValue: p.seatName, enValue: seatEn !== p.seatName ? seatEn : undefined }] : []),
    ...(p.ticketType ? [{ cnLabel: '票种', enLabel: 'Type', cnValue: ticketTypeCn[p.ticketType], enValue: ticketTypeEn[p.ticketType] }] : []),
    { cnLabel: '操作员', enLabel: 'Operator', cnValue: `前台客服 (${p.operatorName})` },
    { cnLabel: '下单时间', enLabel: 'Order Time', cnValue: p.orderTime },
    ...(p.paidAt ? [{ cnLabel: '付款时间', enLabel: 'Paid At', cnValue: p.paidAt }] : []),
    ...(p.printedAt ? [{ cnLabel: '打印时间', enLabel: 'Printed At', cnValue: p.printedAt }] : []),
    { isDivider: true },
    ...(p.ticketPrice !== undefined ? [{ cnLabel: '票价', enLabel: 'Price', cnValue: `${p.ticketPrice.toFixed(2)} ${currencySymbol}` }] : []),
    ...(p.serviceFee !== undefined && p.serviceFee > 0 ? [{ cnLabel: '手续费', enLabel: 'Fee', cnValue: `${p.serviceFee.toFixed(2)} ${currencySymbol}` }] : []),
    ...(p.ticketPrice !== undefined ? [{ cnLabel: '合计', enLabel: 'Total', cnValue: `${totalAmount.toFixed(2)} ${currencySymbol}` }] : []),
    ...(isMixedPayment ? [{ cnLabel: '实付人民币', enLabel: 'RMB Paid', cnValue: `${rmbPaidAmount.toFixed(2)} RMB` }] : []),
    { isDivider: true },
  ];

  const ROW_H = 48 * D;
  const INFO_H = rows.length * ROW_H;
  const QR_H = QR_SIZE + 100 * D;
  const FOOTER_H = 120 * D;
  const H = INFO_START + INFO_H + QR_H + FOOTER_H;

  p.canvas.width = W;
  p.canvas.height = H;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1 * D;
  ctx.strokeRect(1, 1, W - 2, H - 2);

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // ── Header Brand ───────────────────────────────────────────────────────
  ctx.font = `500 ${18 * D}px Arial, sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.fillText('LANKE GROUP', W / 2, 25 * D);
  ctx.font = `500 ${12 * D}px Arial, sans-serif`;
  ctx.fillText('DIGITAL TICKETING PLATFORM', W / 2, 42 * D);
  ctx.textAlign = 'left';

  // ── Purchase Channel Badge (网) ────────────────────────────────────────
  if (p.purchaseChannel === 'online') {
    const badgeX = W - PAD - 40 * D;
    const badgeY = 15 * D;
    const badgeR = 18 * D;
    
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5 * D;
    ctx.stroke();
    
    ctx.font = `500 ${20 * D}px Arial, sans-serif`;
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('网', badgeX, badgeY);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }

  // ── Reprint Badge ──────────────────────────────────────────────────────
  if (p.isReprint) {
    const reprintX = PAD;
    const reprintY = HEADER_H + 10 * D;
    const reprintW = 120 * D;
    const reprintH = 36 * D;
    
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1.5 * D;
    ctx.strokeRect(reprintX, reprintY, reprintW, reprintH);
    
    ctx.font = `500 ${14 * D}px Arial, sans-serif`;
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('补打小票 / REPRINT', reprintX + reprintW / 2, reprintY + reprintH / 2);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }

  // ── Session Title ──────────────────────────────────────────────────────
  const titleY = HEADER_H + (p.isReprint ? 50 * D : 10 * D);
  
  ctx.font = `500 ${22 * D}px Arial, sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.fillText(p.sessionName, PAD, titleY + 20 * D);
  
  if (hasChinese(p.sessionName)) {
    ctx.font = `500 ${14 * D}px Arial, sans-serif`;
    ctx.fillStyle = '#333333';
    ctx.fillText(sessionNameEn, PAD, titleY + 40 * D);
  }

  // ── Divider ────────────────────────────────────────────────────────────
  ctx.setLineDash([4 * D, 2 * D]);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1 * D;
  ctx.beginPath();
  ctx.moveTo(PAD, INFO_START - 10 * D);
  ctx.lineTo(W - PAD, INFO_START - 10 * D);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Info Rows ──────────────────────────────────────────────────────────
  let iy = INFO_START;
  const labelWidth = 100 * D;
  const valueX = PAD + labelWidth + 20 * D;

  for (const row of rows) {
    if (row.isDivider) {
      ctx.setLineDash([4 * D, 2 * D]);
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1 * D;
      ctx.beginPath();
      ctx.moveTo(PAD, iy + 20 * D);
      ctx.lineTo(W - PAD, iy + 20 * D);
      ctx.stroke();
      ctx.setLineDash([]);
      iy += ROW_H;
      continue;
    }

    if (row.cnLabel && row.enLabel) {
      ctx.font = `500 ${14 * D}px Arial, sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.fillText(row.cnLabel, PAD, iy);
      
      ctx.font = `500 ${10 * D}px Arial, sans-serif`;
      ctx.fillStyle = '#333333';
      ctx.fillText(row.enLabel, PAD, iy + 16 * D);
    }

    if (row.cnValue) {
      ctx.textAlign = 'right';
      ctx.font = `500 ${16 * D}px Arial, sans-serif`;
      ctx.fillStyle = '#000000';
      
      if (row.enValue && hasChinese(row.cnValue)) {
        ctx.fillText(row.cnValue, W - PAD, iy);
        ctx.font = `500 ${12 * D}px Arial, sans-serif`;
        ctx.fillStyle = '#333333';
        ctx.fillText(row.enValue, W - PAD, iy + 16 * D);
      } else {
        ctx.textBaseline = 'middle';
        ctx.fillText(row.cnValue, W - PAD, iy + 8 * D);
        ctx.textBaseline = 'alphabetic';
      }
      ctx.textAlign = 'left';
    }

    if (row.valueOnly) {
      ctx.textAlign = 'right';
      ctx.font = `500 ${16 * D}px Arial, sans-serif`;
      ctx.fillStyle = '#000000';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.valueOnly, W - PAD, iy + 8 * D);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
    }

    iy += ROW_H;
  }

  // ── QR Code Section ───────────────────────────────────────────────────
  const qrY = iy + 20 * D;
  const qrX = (W - QR_SIZE) / 2;

  if (p.qrEl) {
    ctx.drawImage(p.qrEl, qrX, qrY, QR_SIZE, QR_SIZE);
  } else {
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(qrX, qrY, QR_SIZE, QR_SIZE);
    ctx.font = `500 ${12 * D}px Arial, sans-serif`;
    ctx.fillStyle = '#666666';
    ctx.textAlign = 'center';
    ctx.fillText('QR CODE', qrX + QR_SIZE / 2, qrY + QR_SIZE / 2);
  }

  // ── Ticket Code ───────────────────────────────────────────────────────
  ctx.font = `500 ${14 * D}px Arial, sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.fillText(p.ticketCode, W / 2, qrY + QR_SIZE + 30 * D);

  // ── Footer ────────────────────────────────────────────────────────────
  const footerY = qrY + QR_SIZE + 50 * D;

  ctx.font = `500 ${12 * D}px Arial, sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.fillText('入场时出示二维码供工作人员核销', W / 2, footerY);
  
  ctx.font = `500 ${10 * D}px Arial, sans-serif`;
  ctx.fillStyle = '#333333';
  ctx.fillText('Present QR code for verification', W / 2, footerY + 18 * D);

  ctx.font = `500 ${10 * D}px Arial, sans-serif`;
  ctx.fillStyle = '#000000';
  ctx.fillText('https://lankegroup-booking.netlify.app/', W / 2, footerY + 40 * D);

  ctx.font = `500 ${10 * D}px Arial, sans-serif`;
  ctx.fillStyle = '#333333';
  ctx.fillText('© 兰克集团数智一体化票务运营平台', W / 2, footerY + 60 * D);

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
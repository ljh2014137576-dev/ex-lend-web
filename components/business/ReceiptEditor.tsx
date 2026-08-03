"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toJpeg, toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { Order } from "@/lib/mock-data";

type Item = { id: number; name: string; quantity: number; unitPrice: number };
type Density = "normal" | "compact";

declare global {
  interface Window {
    receiptDesktop?: { copyPng: (dataUrl: string) => Promise<void> };
  }
}

const DEFAULT_FONT = '"YouSheBiaoTiHei", "Noto Sans CJK", sans-serif';

function money(value: number) {
  return (Math.round((Number.isFinite(value) ? value : 0) * 100) / 100).toFixed(2);
}

function formatDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(parsed);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toLocalInput(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

function nowLocalInput() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

function orderToReceipt(order: Order) {
  return {
    customer: order.customerName,
    receiptNo: order.orderNo,
    date: toLocalInput(order.createdAt) || nowLocalInput(),
    qrText: order.orderNo,
    qrLabel: "扫码查询",
    barcodeLabel: "小票条码",
    note: "感谢您的光临",
    watermark: "SAMPLE / 样例",
    items: order.items.map((it, index) => ({
      id: index + 1,
      name: it.productName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
    })),
  };
}

async function waitForReceiptAssets(node: HTMLElement) {
  await document.fonts?.ready;
  const images = Array.from(node.querySelectorAll("img"));
  await Promise.all(images.map(async (image) => {
    if (!image.complete) {
      await new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    }
    if (image.naturalWidth > 0) await image.decode().catch(() => undefined);
  }));
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function ReceiptEditor({
  order,
  open,
  onClose,
}: {
  order: Order | null;
  open: boolean;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [customer, setCustomer] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [date, setDate] = useState(nowLocalInput());
  const [qrText, setQrText] = useState("");
  const [qrLabel, setQrLabel] = useState("扫码查询");
  const [barcodeLabel, setBarcodeLabel] = useState("小票条码");
  const [note, setNote] = useState("感谢您的光临");
  const [paperWidth, setPaperWidth] = useState<58 | 68 | 80>(68);
  const [density, setDensity] = useState<Density>("normal");
  const [textureStrength, setTextureStrength] = useState(0.75);
  const [fontFamily, setFontFamily] = useState(DEFAULT_FONT);
  const [captionFontSize, setCaptionFontSize] = useState(13);
  const [watermark, setWatermark] = useState("SAMPLE / 样例");
  const [qrImage, setQrImage] = useState("");
  const [zoom, setZoom] = useState(100);
  const [toast, setToast] = useState("");
  const receiptRef = useRef<HTMLDivElement>(null);
  const barcodeRef = useRef<SVGSVGElement>(null);
  const barcodeWrapRef = useRef<HTMLDivElement>(null);

  // 打开时按订单预填
  useEffect(() => {
    if (open && order) {
      const d = orderToReceipt(order);
      setItems(d.items);
      setCustomer(d.customer);
      setReceiptNo(d.receiptNo);
      setDate(d.date);
      setQrText(d.qrText);
      setQrLabel(d.qrLabel);
      setBarcodeLabel(d.barcodeLabel);
      setNote(d.note);
      setWatermark(d.watermark);
    }
  }, [open, order]);

  const subtotal = useMemo(
    () => items.reduce((sum, item) => sum + Math.round(item.quantity * item.unitPrice * 100) / 100, 0),
    [items],
  );

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(qrText || " ", { margin: 1, width: 260, errorCorrectionLevel: "M" })
      .then((url) => { if (active) setQrImage(url); })
      .catch(() => { if (active) setQrImage(""); });
    return () => { active = false; };
  }, [qrText]);

  useEffect(() => {
    const svg = barcodeRef.current;
    if (!svg) return;
    const value = receiptNo || "000000000000";
    const draw = (barWidth: number) => {
      svg.replaceChildren();
      JsBarcode(svg, value, {
        format: "CODE128", lineColor: "#111", width: barWidth, height: 41, displayValue: false, margin: 0,
      });
    };
    try {
      // 两遍渲染：先按 barWidth=1 量自然宽度，再按容器实际宽度（条码区 flex 撑满剩余宽度）反算 barWidth，
      // 使条码长度自适应纸宽（80mm 更长、58mm 较短），高度恒为 41px，且不超宽。
      draw(1);
      const natural = svg.getBBox().width || 1;
      const targetWidth = Math.max(60, (barcodeWrapRef.current?.clientWidth || 120) * 0.75);
      const barWidth = Math.max(0.25, Math.min(2.2, targetWidth / natural));
      draw(barWidth);
      const renderedW = Math.round(svg.getBBox().width);
      svg.setAttribute("width", String(renderedW));
      svg.setAttribute("height", "41");
      svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    } catch {
      svg.setAttribute("aria-label", "条形码内容无效");
    }
  }, [receiptNo, paperWidth]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function useCurrentDateTime() {
    setDate(nowLocalInput());
  }

  function restoreOrder() {
    if (!order) return;
    const d = orderToReceipt(order);
    setItems(d.items); setCustomer(d.customer); setReceiptNo(d.receiptNo); setDate(d.date);
    setQrText(d.qrText); setQrLabel(d.qrLabel); setBarcodeLabel(d.barcodeLabel); setNote(d.note);
    setWatermark(d.watermark); setPaperWidth(68); setDensity("normal"); setTextureStrength(0.75);
    setFontFamily(DEFAULT_FONT); setCaptionFontSize(13);
    notify("已恢复订单默认");
  }

  function updateItem(id: number, key: keyof Item, value: string) {
    setItems((current) => current.map((item) => {
      if (item.id !== id) return item;
      if (key === "name") return { ...item, name: value };
      const number = Number(value);
      return { ...item, [key]: Number.isFinite(number) ? Math.max(0, number) : 0 };
    }));
  }

  function addItem() {
    setItems((current) => [...current, { id: Date.now(), name: "新商品", quantity: 1, unitPrice: 0 }]);
  }

  function removeItem(id: number) {
    setItems((current) => current.filter((item) => item.id !== id));
  }

  async function renderPng() {
    if (!receiptRef.current) throw new Error("小票预览尚未准备好");
    await waitForReceiptAssets(receiptRef.current);
    return toPng(receiptRef.current, { pixelRatio: 3, cacheBust: true });
  }

  async function copyPng() {
    try {
      notify("正在复制到剪贴板…");
      const dataUrl = await renderPng();
      if (window.receiptDesktop) {
        await window.receiptDesktop.copyPng(dataUrl);
      } else if (navigator.clipboard?.write && "ClipboardItem" in window) {
        const blob = await (await fetch(dataUrl)).blob();
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      } else {
        throw new Error("当前浏览器不支持图片剪贴板");
      }
      notify("PNG 已复制到剪贴板");
    } catch {
      notify("无法写入剪贴板，请检查系统权限或下载 PNG");
    }
  }

  async function exportImage(format: "png" | "jpeg" | "pdf") {
    if (!receiptRef.current) return;
    try {
      notify("正在生成文件…");
      await waitForReceiptAssets(receiptRef.current);
      const options = { pixelRatio: 3, cacheBust: true };
      const dataUrl = format === "jpeg"
        ? await toJpeg(receiptRef.current, { ...options, backgroundColor: "#f8f8f5", quality: 0.94 })
        : await toPng(receiptRef.current, options);
      if (format === "pdf") {
        const height = (receiptRef.current.offsetHeight / receiptRef.current.offsetWidth) * paperWidth;
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [paperWidth, height] });
        pdf.setFillColor(248, 248, 245);
        pdf.rect(0, 0, paperWidth, height, "F");
        pdf.addImage(dataUrl, "PNG", 0, 0, paperWidth, height);
        pdf.save("receipt-" + (receiptNo || "sample") + ".pdf");
      } else {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = "receipt-" + (receiptNo || "sample") + "." + format;
        link.click();
      }
      notify(format.toUpperCase() + " 已导出");
    } catch {
      notify("导出失败，请稍后重试");
    }
  }

  return (
    <Modal open={open} title="生成小票" onClose={onClose} xwide>
      <div className="max-h-[82vh] overflow-y-auto">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-muted">实时预览 · {paperWidth} mm · {items.length} 项</span>
              <div className="ml-auto flex items-center gap-1">
                <Button size="sm" variant="secondary" onClick={() => setZoom((v) => Math.max(70, v - 10))}>−</Button>
                <span className="w-12 text-center font-mono text-xs tabular-nums">{zoom}%</span>
                <Button size="sm" variant="secondary" onClick={() => setZoom((v) => Math.min(140, v + 10))}>＋</Button>
              </div>
            </div>
            <div className="overflow-auto border border-dashed border-line bg-surface2/60 p-6">
              <div className="mx-auto w-max">
                <div className="receipt-shadow" style={{ transform: "scale(" + zoom / 100 + ")", transformOrigin: "top center" }}>
                  <div className="receipt" ref={receiptRef} data-density={density} style={{ width: paperWidth + "mm", fontFamily, fontWeight: 700, ["--texture-strength" as string]: textureStrength }}>
                    <div className="receipt-watermark">{watermark}</div>
                    <div className="hero-layer">
                      <img className="fixed-asset banner-asset" src="/receipt/qingyan-banner.png" alt="星空装饰横幅" />
                      <img className="fixed-asset title-asset" src="/receipt/qingyan-title-repaired-trim.png" alt="青盐标题" />
                      <div className="hero-caption" style={{ fontSize: captionFontSize + "px" }}>· · ·　消费记录　· · ·</div>
                    </div>
                    <div className="receipt-meta">
                      <span>{formatDate(date)}</span>
                      <span>#{receiptNo || "—"}</span>
                    </div>
                    <div className="purchase-layer">
                      <div className="purchase-head"><span>商品</span><span>数量</span><span>金额</span></div>
                      {items.map((item) => (
                        <div className="purchase-row" key={item.id}>
                          <span>{item.name || "未命名商品"}</span>
                          <span>{item.quantity}</span>
                          <span>¥{money(item.quantity * item.unitPrice)}</span>
                        </div>
                      ))}
                      <div className="purchase-total"><span>合计</span><strong>¥{money(subtotal)}</strong></div>
                      <div className="customer-row"><span>消费者</span><strong>{customer || "—"}</strong></div>
                    </div>
                    <div className="thank-art-layer">
                      <img src="/receipt/thank-you-pixel-art-tight.png" alt="THANK YOU 像素装饰" />
                    </div>
                    <div className="codes-layer">
                      <div className="qr-side">
                        <div className="code-title"><i>✦</i>{qrLabel || "扫码关注"}<i>✦</i></div>
                        <div className="code-visual qr-visual">{qrImage && <img src={qrImage} alt="二维码" />}</div>
                        <div className="code-caption">青盐</div>
                      </div>
                      <div className="code-divider" />
                      <div className="barcode-side">
                        <div className="code-title"><i>✦</i>{barcodeLabel || "小票条码"}<i>✦</i></div>
                        <div className="code-visual barcode-visual" ref={barcodeWrapRef}><svg ref={barcodeRef} className="barcode" aria-label="条形码" /></div>
                      </div>
                    </div>
                    <div className="thank-you"><span>♥</span><p>{note || "感谢您的光临"}</p><span>♥</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="border-b border-line pb-1 font-mono text-[11px] text-muted">文字图层</p>
            <label className="block">
              <span className="font-mono text-[11px] text-muted">消费者名称</span>
              <Input value={customer} onChange={(e) => setCustomer(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="font-mono text-[11px] text-muted">生成日期</span>
                <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="block">
                <span className="font-mono text-[11px] text-muted">说明字号</span>
                <Input type="number" min={8} max={22} value={captionFontSize} onChange={(e) => setCaptionFontSize(Math.min(22, Math.max(8, Number(e.target.value) || 8)))} />
              </label>
            </div>
            <label className="block">
              <span className="font-mono text-[11px] text-muted">小票编号（条码内容）</span>
              <Input value={receiptNo} onChange={(e) => setReceiptNo(e.target.value)} />
            </label>
            <label className="block">
              <span className="font-mono text-[11px] text-muted">二维码内容</span>
              <Input value={qrText} onChange={(e) => setQrText(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="font-mono text-[11px] text-muted">二维码标题</span>
                <Input value={qrLabel} onChange={(e) => setQrLabel(e.target.value)} />
              </label>
              <label className="block">
                <span className="font-mono text-[11px] text-muted">条码标题</span>
                <Input value={barcodeLabel} onChange={(e) => setBarcodeLabel(e.target.value)} />
              </label>
            </div>
            <label className="block">
              <span className="font-mono text-[11px] text-muted">底部感谢语</span>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>

            <p className="border-b border-line pb-1 font-mono text-[11px] text-muted">购买明细（{items.length} 项）</p>
            <div className="space-y-1.5">
              {items.map((item) => (
                <div key={item.id} className="flex items-center gap-1.5">
                  <Input value={item.name} onChange={(e) => updateItem(item.id, "name", e.target.value)} className="min-w-0 flex-1" aria-label="商品名" />
                  <Input type="number" min={0} step={0.5} value={item.quantity} onChange={(e) => updateItem(item.id, "quantity", e.target.value)} className="w-16" aria-label="数量" />
                  <Input type="number" min={0} step={0.01} value={item.unitPrice} onChange={(e) => updateItem(item.id, "unitPrice", e.target.value)} className="w-20" aria-label="单价" />
                  <Button size="sm" variant="secondary" onClick={() => removeItem(item.id)}>×</Button>
                </div>
              ))}
              <Button size="sm" variant="secondary" onClick={addItem}>＋ 添加商品</Button>
            </div>

            <p className="border-b border-line pb-1 font-mono text-[11px] text-muted">画布</p>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-[11px] text-muted">纸宽</span>
              <div className="flex overflow-hidden rounded-md border border-line">
                {([58, 68, 80] as const).map((w) => (
                  <button key={w} type="button" onClick={() => setPaperWidth(w)} className={paperWidth === w ? "bg-nav-active px-3 py-1 text-xs text-nav-active-text" : "bg-paper px-3 py-1 text-xs text-muted hover:bg-surface2"}>{w}mm</button>
                ))}
              </div>
              <span className="font-mono text-[11px] text-muted">密度</span>
              <div className="flex overflow-hidden rounded-md border border-line">
                {([["normal", "舒展"], ["compact", "紧凑"]] as const).map(([k, label]) => (
                  <button key={k} type="button" onClick={() => setDensity(k)} className={density === k ? "bg-nav-active px-3 py-1 text-xs text-nav-active-text" : "bg-paper px-3 py-1 text-xs text-muted hover:bg-surface2"}>{label}</button>
                ))}
              </div>
            </div>
            <label className="block">
              <span className="font-mono text-[11px] text-muted">纹理强度 {Math.round(textureStrength * 100)}%</span>
              <input type="range" min={0} max={1} step={0.05} value={textureStrength} onChange={(e) => setTextureStrength(Number(e.target.value))} className="w-full" />
            </label>
            <label className="block">
              <span className="font-mono text-[11px] text-muted">样例水印</span>
              <Input value={watermark} onChange={(e) => setWatermark(e.target.value)} />
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button size="sm" variant="secondary" onClick={useCurrentDateTime}>当前时间</Button>
          <Button size="sm" variant="secondary" onClick={restoreOrder}>恢复订单默认</Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => void copyPng()}>复制 PNG</Button>
            <Button size="sm" variant="secondary" onClick={() => void exportImage("png")}>PNG</Button>
            <Button size="sm" variant="secondary" onClick={() => void exportImage("jpeg")}>JPEG</Button>
            <Button size="sm" onClick={() => void exportImage("pdf")}>PDF</Button>
          </div>
        </div>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </Modal>
  );
}

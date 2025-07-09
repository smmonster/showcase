import React, { useState, useEffect } from "react";
import Tesseract from "tesseract.js";
import "./App.css";

const FIXED_HEIGHT = 60;
const GUIDE_RIGHT_WIDTH = 42;
const MAX_WIDTH = 640;

const GUIDE_LIST = [
  { name: "Guide 1", file: "../public/01_eng_upper.png", desc: "영문 대문자로 구성" },
  { name: "Guide 2", file: "../public/02_eng_uplow_case1.png", desc: "영문 대/소문자 (g, j, p, q, y 없음)" },
  { name: "Guide 3", file: "../public/03_eng_uplow_case2.png", desc: "영문 대/소문자 (g, j, p, q, y 있음)" },
  { name: "Guide 4", file: "../public/04_eng_lower_case1.png", desc: "영문 소문자 (g, j, p, q, y 있음)" },
  { name: "Guide 5", file: "../public/05_eng_lower_case2.png", desc: "영문 소문자 (b, d, f, h, i, k, l, t 있음)" },
  { name: "Guide 6", file: "../public/06_eng_lower_case3.png", desc: "영문 소문자 (위 소문자 모두 포함)" },
  { name: "Guide 7", file: "../public/07_eng_lower_case4.png", desc: "영문 소문자 (g, j, p, q, y 및 위 소문자 모두 없음)" },
  { name: "Guide 8", file: "../public/08_eng_etc.png", desc: "문자구분 어려움/예외" },
  { name: "Guide 9", file: "/09_kor.png", desc: "한글로 구성" },
];
const RIGHT_GUIDE_FILE = "/right_guide.png";

function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
  const num = parseInt(hex, 16);
  return [num >> 16, (num >> 8) & 0xff, num & 0xff];
}
function channelLuminance(c) {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function getContrastRatio(hex1, hex2) {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const l1 = 0.2126 * channelLuminance(r1) + 0.7152 * channelLuminance(g1) + 0.0722 * channelLuminance(b1);
  const l2 = 0.2126 * channelLuminance(r2) + 0.7152 * channelLuminance(g2) + 0.0722 * channelLuminance(b2);
  const bright = Math.max(l1, l2);
  const dark = Math.min(l1, l2);
  return ((bright + 0.05) / (dark + 0.05));
}

function recommendGuideByOcr(text) {
  const clean = text.replace(/\s/g, "");
  if (!clean) return { idx: 7, msg: "예외(문자 구분 불가)" }; // Guide 8

  if (/^[가-힣]+$/.test(clean)) return { idx: 8, msg: "한글만 구성 → Guide 9" };
  if (/^[A-Z]+$/.test(clean)) return { idx: 0, msg: "영문 대문자만 → Guide 1" };

  if (/^[a-z]+$/.test(clean)) {
    const upLetters = "bdfhiklt".split("");
    const downLetters = "gjpqy".split("");
    const hasUp = upLetters.some((c) => clean.includes(c));
    const hasDown = downLetters.some((c) => clean.includes(c));
    if (hasUp && hasDown) return { idx: 5, msg: "모두 있음 → Guide 6" };
    if (hasUp) return { idx: 4, msg: "up만 있음 → Guide 5" };
    if (hasDown) return { idx: 3, msg: "down만 있음 → Guide 4" };
    return { idx: 6, msg: "둘 다 없음 → Guide 7" };
  }

  if (/^(?=.*[a-z])(?=.*[A-Z])[a-zA-Z]+$/.test(clean)) {
    const downLetters = "gjpqy".split("");
    const hasDown = downLetters.some((c) => clean.includes(c));
    if (hasDown) return { idx: 2, msg: "g/j/p/q/y 있음 → Guide 3" };
    else return { idx: 1, msg: "g/j/p/q/y 없음 → Guide 2" };
  }
  return { idx: 7, msg: "예외(문자 구분 불가)" }; // Guide 8
}

function checkPngTransparency(dataUrl, width, height) {
  return new Promise((resolve) => {
    if (!dataUrl.endsWith(".png") && !dataUrl.includes("image/png")) return resolve(false);
    const img = new window.Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height).data;
      for (let i = 3; i < imageData.length; i += 16 * 4) {
        if (imageData[i] < 250) return resolve(true);
      }
      resolve(false);
    };
    img.src = dataUrl;
  });
}

function makeContrastImageWithoutRight(dataUrl, width, height, rightWidth = GUIDE_RIGHT_WIDTH) {
  return new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => {
      const newWidth = Math.max(1, width - rightWidth);
      const canvas = document.createElement("canvas");
      canvas.width = newWidth;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, newWidth, height);
      ctx.drawImage(img, 0, 0, newWidth, height, 0, 0, newWidth, height);
      resolve(canvas.toDataURL());
    };
    img.src = dataUrl;
  });
}

const TAB_LIST = [
  { key: "basic", label: "기본가이드 검수" },
  { key: "margin", label: "여백가이드 검수" }
];

export default function MultiGuideOverlayApp() {
  const [uploadedImage, setUploadedImage] = useState(null);
  const [uploadedImageInfo, setUploadedImageInfo] = useState({
    width: null, height: null, size: null, type: null, name: null, isPng: false, isTransparent: false
  });
  const [opacity, setOpacity] = useState(0.65);
  const [bgColor, setBgColor] = useState("#0A0A0A");

  const [ocrLoading, setOcrLoading] = useState(false);
  const [showOcrResult, setShowOcrResult] = useState(false);
  const [ocrText, setOcrText] = useState("");
  const [ocrGuideIdx, setOcrGuideIdx] = useState(null);
  const [manualGuideIdx, setManualGuideIdx] = useState(null);

  // 탭 상태: "basic" | "margin"
  const [tab, setTab] = useState("basic");

  // [추가] margin 탭이 눌릴 때마다 OCR 모션 강제 실행
  useEffect(() => {
    if (tab === "margin" && uploadedImage) {
      setOcrLoading(true);
      if (ocrText) {
        // 이미 결과 있으면 1초만 모션 보여주고 끝
        const timer = setTimeout(() => setOcrLoading(false), 1000);
        return () => clearTimeout(timer);
      }
    }
  // eslint-disable-next-line
  }, [tab, uploadedImage]); // tab, uploadedImage 변할 때마다

  const handleBgColorChange = (e) => {
    let val = e.target.value;
    if (!val.startsWith("#")) val = "#" + val.replace(/[^a-fA-F0-9]/g, "");
    setBgColor(val.slice(0, 7));
  };

  const contrastWithWhite = getContrastRatio(bgColor, "#ffffff");

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const name = file.name;
      const size = file.size;
      const type = file.type;
      const isPng = type === "image/png" || name.toLowerCase().endsWith(".png");
      const reader = new FileReader();
      reader.onload = (ev) => {
        setUploadedImage(ev.target.result);

        const img = new window.Image();
        img.onload = async function () {
          const w = Math.max(Math.min(img.width, MAX_WIDTH), GUIDE_RIGHT_WIDTH + 10);
          let isTransparent = false;
          if (isPng) isTransparent = await checkPngTransparency(ev.target.result, w, FIXED_HEIGHT);

          setUploadedImageInfo({
            width: w, height: img.height, size, type, name, isPng, isTransparent
          });

          setOcrLoading(true);
          setShowOcrResult(false);
          setOcrText("");
          setOcrGuideIdx(null);
          setManualGuideIdx(null);

          const contrastDataUrl = await makeContrastImageWithoutRight(ev.target.result, w, FIXED_HEIGHT, GUIDE_RIGHT_WIDTH);

          Tesseract.recognize(contrastDataUrl, "kor+eng")
            .then(({ data: { text } }) => {
              const cleaned = text.trim();
              const reco = recommendGuideByOcr(cleaned);
              setTimeout(() => {
                setOcrLoading(false);
                setShowOcrResult(true);
                setOcrText(cleaned);
                setOcrGuideIdx(reco.idx);
                setManualGuideIdx(null);
              }, 2000);
            });
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGuideListClick = idx => setManualGuideIdx(idx);

  const selectedGuideIdx = manualGuideIdx !== null ? manualGuideIdx : ocrGuideIdx;
  const previewWidth = uploadedImageInfo.width || MAX_WIDTH;

  const formatSize = (bytes) => {
    if (!bytes && bytes !== 0) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="multi-overlay-root">
      <div className="multi-overlay-card">
        <h1 className="multi-overlay-title">쇼케이스 EAST 로고 검수</h1>
        <p className="multi-overlay-desc">
          * 소재 기본 가이드 검수<br/>
          * 소재 여백 가이드 검수 (/w OCR 자동 인식)
        </p>
        {/* 로고 업로드 */}
        <div className="overlay-upload-area">
          <label htmlFor="img-upload" className="overlay-upload-btn">
            <span className="upload-arrow" /> 쇼케이스 로고 업로드
            <input
              id="img-upload"
              type="file"
              accept="image/*"
              onChange={handleFileChange}
            />
          </label>
        </div>
        {/* 탭 네비 */}
        <div className="tab-nav">
          {TAB_LIST.map(({ key, label }) => (
            <button
              key={key}
              className={`tab-btn${tab === key ? " active" : ""}`}
              onClick={() => setTab(key)}
              type="button"
            >{label}</button>
          ))}
        </div>
        {uploadedImage && (
          <div className="all-check-area">
            {/* --- 2개 탭 컨텐츠 --- */}
            {tab === "basic" && (
              <>
                {/* 등록된 이미지 */}
                <div
                  className="overlay-preview-zone overlay-preview-zone-wide overlay-preview-origin"
                  style={{
                    background: bgColor,
                    width: previewWidth,
                    height: FIXED_HEIGHT,
                    marginTop: "14px"
                  }}>
                  <img
                    src={uploadedImage}
                    alt="광고주 원본"
                    className="overlay-img overlay-img-wide"
                    style={{
                      width: previewWidth,
                      height: FIXED_HEIGHT
                    }}
                  />
                </div>
                <div className="overlay-bgcolor-zone overlay-bgcolor-below">
                  <label className="overlay-bgcolor-label">
                    배경 컬러:
                    <input
                      type="color"
                      value={bgColor}
                      onChange={handleBgColorChange}
                      className="overlay-bgcolor-input"
                    />
                    <input
                      type="text"
                      value={bgColor}
                      onChange={handleBgColorChange}
                      className="overlay-bgcolor-text"
                      maxLength={7}
                      placeholder="#0A0A0A"
                    />
                  </label>
                </div>
                {/* 기본가이드 검수 */}
                <div className="ad-info-box-check">
                  <div className="info-check-row">
                    <span className="info-check-icon">
                      {uploadedImageInfo.width <= 360 && uploadedImageInfo.height === 60
                        ? <span className="check-green">✔</span>
                        : <span className="check-red">✖</span>}
                    </span>
                    <span className="info-check-label">사이즈</span>
                    <span className="info-check-value">
                      {uploadedImageInfo.width} x {uploadedImageInfo.height} px
                      <span className="info-check-criteria"> (가로 360px 이하, 세로 60px)</span>
                    </span>
                  </div>
                  <div className="info-check-row">
                    <span className="info-check-icon">
                      {uploadedImageInfo.size <= 50 * 1024
                        ? <span className="check-green">✔</span>
                        : <span className="check-red">✖</span>}
                    </span>
                    <span className="info-check-label">용량</span>
                    <span className="info-check-value">
                      {formatSize(uploadedImageInfo.size)}
                      <span className="info-check-criteria"> (50KB 이하)</span>
                    </span>
                  </div>
                  <div className="info-check-row">
                    <span className="info-check-icon">
                      {uploadedImageInfo.isPng
                        ? <span className="check-green">✔</span>
                        : <span className="check-red">✖</span>}
                    </span>
                    <span className="info-check-label">포맷</span>
                    <span className="info-check-value">
                      {uploadedImageInfo.type} {uploadedImageInfo.isPng ? "(PNG)" : ""}
                      <span className="info-check-criteria"> (PNG만 허용)</span>
                    </span>
                  </div>
                  <div className="info-check-row">
                    <span className="info-check-icon">
                      {uploadedImageInfo.isPng && uploadedImageInfo.isTransparent
                        ? <span className="check-green">✔</span>
                        : <span className="check-red">✖</span>}
                    </span>
                    <span className="info-check-label">투명</span>
                    <span className="info-check-value">
                      {uploadedImageInfo.isPng
                        ? (uploadedImageInfo.isTransparent ? "투명 있음" : "투명 아님")
                        : "-"}
                      <span className="info-check-criteria"> (반드시 투명)</span>
                    </span>
                  </div>
                  <div className="info-check-row">
                    <span className="info-check-icon">
                      {(() => {
                        const ratio = getContrastRatio(bgColor, "#ffffff");
                        return ratio >= 2.0
                          ? <span className="check-green">✔</span>
                          : <span className="check-red">✖</span>;
                      })()}
                    </span>
                    <span className="info-check-label">명암비</span>
                    <span className="info-check-value">
                      {(() => {
                        const ratio = getContrastRatio(bgColor, "#ffffff");
                        return (
                          <>
                            {ratio.toFixed(2)}
                            <span className="info-check-criteria"> (배경 - 로고 명암비 2.0 이상)</span>
                          </>
                        );
                      })()}
                    </span>
                  </div>
                </div>
              </>
            )}

            {tab === "margin" && (
              <>
                <div className="guide-layout-2col">
                  <div className="guide-overlay-preview-col">
                    <div className="ocr-status-block terminal-style">
                      {ocrLoading && (
                        <>
                          <div className="ocr-terminal-row ocr-progress"># ocr 인식 중 <span className="terminal-dot-anim"><span>.</span><span>.</span><span>.</span></span></div>
                        </>
                      )}
                      {!ocrLoading && showOcrResult && (
                        <>
                          <div className="ocr-terminal-row ocr-progress"># ocr 인식 중 ...</div>
                          <div className="ocr-terminal-row ocr-complete"># ocr 인식 완료</div>
                          <div className="ocr-terminal-row ocr-brand">{ocrText || "인식 결과 없음"}</div>
                        </>
                      )}
                    </div>
                    {ocrGuideIdx !== null && (
                      <div className="ocr-terminal-row ocr-guide">
                        {"#"} <b>(추천) {GUIDE_LIST[ocrGuideIdx].name}</b>
                        <span className="ocr-guide-desc">{GUIDE_LIST[ocrGuideIdx].desc}</span>
                      </div>
                    )}
                    {/* 2. 오버레이 적용 미리보기 */}
                    <div
                      className="overlay-preview-zone overlay-preview-zone-wide"
                      style={{
                        background: bgColor,
                        width: previewWidth,
                        height: FIXED_HEIGHT
                      }}>
                      <img
                        src={uploadedImage}
                        alt="광고주"
                        className="overlay-img overlay-img-wide"
                        style={{
                          width: previewWidth,
                          height: FIXED_HEIGHT
                        }}
                      />
                      {/* left 가이드 오버레이 */}
                      {selectedGuideIdx !== null && (
                        <img
                          src={`/${GUIDE_LIST[selectedGuideIdx].file}`}
                          alt={`Guide overlay left`}
                          className="overlay-img overlay-guide overlay-guide-left"
                          style={{
                            width: previewWidth - GUIDE_RIGHT_WIDTH,
                            height: FIXED_HEIGHT,
                            left: 0,
                            top: 0,
                            opacity
                          }}
                        />
                      )}
                      {/* 공통 right 가이드 오버레이 */}
                      {selectedGuideIdx !== null && (
                        <img
                          src={`/${RIGHT_GUIDE_FILE}`}
                          alt="Guide overlay right"
                          className="overlay-img overlay-guide overlay-guide-right"
                          style={{
                            width: GUIDE_RIGHT_WIDTH,
                            height: FIXED_HEIGHT,
                            left: previewWidth - GUIDE_RIGHT_WIDTH,
                            top: 0,
                            opacity
                          }}
                        />
                      )}
                    </div>
                    <div className="overlay-opacity-slider">
                      <label>
                        가이드 투명도&nbsp;
                        <input
                          type="range"
                          min={0.1}
                          max={1}
                          step={0.05}
                          value={opacity}
                          onChange={e => setOpacity(Number(e.target.value))}
                        />
                        <span className="slider-value">{Math.round(opacity * 100)}%</span>
                      </label>
                    </div>
                  </div>
                  <div className="guide-list-col">
                    <ul className="guide-list-ul">
                      {GUIDE_LIST.map((g, idx) => (
                        <li
                          key={g.file}
                          className={`guide-list-item${selectedGuideIdx === idx ? " active" : ""}${ocrGuideIdx === idx && manualGuideIdx === null ? " recommended" : ""}`}
                          onClick={() => handleGuideListClick(idx)}
                        >
                          <div className="guide-list-title">
                            <b>{g.name}</b>
                            {ocrGuideIdx === idx && manualGuideIdx === null && (
                              <span className="guide-recommend-badge">추천</span>
                            )}
                          </div>
                          <div className="guide-list-desc">{g.desc}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div className="multi-overlay-footer">
        ⓒ {new Date().getFullYear()} 광고 소재 오버레이 비교 툴
      </div>
    </div>
  );
}

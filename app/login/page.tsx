"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

/*
 * 登录页：带交互动画角色的样式。
 * 忠实移植自 C:\Users\monting\AppData\Local\Temp\animatedlogin\index.html
 * （左侧 4 个纯 CSS 角色：紫色/黑色圆角矩形、橙色半圆、黄色圆角矩形；
 *  眼睛/瞳孔跟随鼠标、随机眨眼、输入邮箱对视、输入密码回避、显示密码偷看、
 *  登录失败摇头 + 橙色悲伤嘴、按钮悬停文字滑出 + 紫色底 + 箭头滑入）。
 * 品牌改为 Ex-Lend，文案中文；去掉 Google 登录、Remember/Forgot/Sign Up。
 * 登录走 Supabase signInWithPassword，成功后由 useAuth 的 isAuthed 自动跳转。
 */

const LOGIN_STYLES = `
  .exl-login-page {
    display: grid;
    grid-template-columns: 1fr 1fr;
    height: 100vh;
    min-height: 100vh;
    overflow: hidden;
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }

  /* ============ LEFT PANEL ============ */
  .exl-left-panel {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    background: linear-gradient(135deg, #d4d0dc 0%, #c8c4d0 50%, #bbb7c5 100%);
    padding: 40px 48px;
    overflow: hidden;
  }

  .exl-left-panel .exl-logo {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 16px;
    font-weight: 600;
    color: #fff;
    z-index: 10;
    position: relative;
  }

  .exl-left-panel .exl-logo svg {
    width: 28px;
    height: 28px;
    background: rgba(255, 255, 255, 0.15);
    backdrop-filter: blur(8px);
    padding: 4px;
    border-radius: 6px;
  }

  .exl-characters-wrapper {
    position: relative;
    z-index: 10;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    height: 420px;
  }

  .exl-footer-links {
    display: flex;
    gap: 28px;
    font-size: 13px;
    color: rgba(80, 70, 90, 0.7);
    z-index: 10;
    position: relative;
  }

  /* Decorative blurs */
  .exl-left-panel::after {
    content: "";
    position: absolute;
    top: 20%;
    right: 15%;
    width: 260px;
    height: 260px;
    background: rgba(180, 170, 200, 0.25);
    border-radius: 50%;
    filter: blur(80px);
  }

  .exl-left-panel::before {
    content: "";
    position: absolute;
    bottom: 15%;
    left: 10%;
    width: 350px;
    height: 350px;
    background: rgba(200, 195, 210, 0.2);
    border-radius: 50%;
    filter: blur(100px);
  }

  /* ============ RIGHT PANEL ============ */
  .exl-right-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    padding: 40px;
  }

  .exl-form-container {
    width: 100%;
    max-width: 400px;
  }

  .exl-sparkle-icon {
    display: flex;
    justify-content: center;
    margin-bottom: 24px;
  }

  .exl-sparkle-icon svg {
    width: 32px;
    height: 32px;
  }

  .exl-form-header {
    text-align: center;
    margin-bottom: 36px;
  }

  .exl-form-header h1 {
    font-size: 28px;
    font-weight: 700;
    color: #1a1a2e;
    letter-spacing: -0.5px;
    margin-bottom: 6px;
  }

  .exl-form-header p {
    font-size: 14px;
    color: #888;
  }

  /* ============ FORM FIELDS ============ */
  .exl-form-group {
    margin-bottom: 20px;
  }

  .exl-form-group label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: #333;
    margin-bottom: 8px;
  }

  .exl-form-group .exl-input-wrapper {
    position: relative;
  }

  .exl-form-group input {
    width: 100%;
    height: 48px;
    border: none;
    border-bottom: 1.5px solid #e0e0e0;
    padding: 0 40px 0 0;
    font-size: 15px;
    font-family: inherit;
    color: #1a1a2e;
    background: transparent;
    outline: none;
    transition: border-color 0.3s;
  }

  .exl-form-group input:focus {
    border-bottom-color: #5b21b6;
  }

  .exl-form-group input::placeholder {
    color: #ccc;
  }

  .exl-form-group input[type="password"]:not(:placeholder-shown) {
    font-family: inherit;
    letter-spacing: 2px;
  }

  /* Hide browser-provided password reveal/clear buttons (e.g. Edge) */
  .exl-form-group input[type="password"]::-ms-reveal,
  .exl-form-group input[type="password"]::-ms-clear {
    display: none;
  }

  .exl-toggle-password {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    cursor: pointer;
    color: #666;
    padding: 6px;
    transition: color 0.2s;
  }

  .exl-toggle-password:hover {
    color: #333;
  }

  /* ============ ERROR ============ */
  .exl-error-msg {
    padding: 10px 14px;
    font-size: 13px;
    color: #dc2626;
    background: rgba(220, 38, 38, 0.08);
    border: 1px solid rgba(220, 38, 38, 0.2);
    border-radius: 10px;
    margin-bottom: 16px;
  }

  .exl-form-group input.exl-error {
    border-bottom-color: #dc2626;
  }

  .exl-form-group label.exl-error-label {
    color: #dc2626;
  }

  /* ============ LOGIN BUTTON ============ */
  .exl-btn-login {
    position: relative;
    width: 100%;
    height: 50px;
    border-radius: 25px;
    border: 1.5px solid #1a1a2e;
    background: #1a1a2e;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    overflow: hidden;
    margin-top: 14px;
    transition: all 0.3s;
  }

  .exl-btn-login:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .exl-btn-login .exl-btn-text {
    display: inline-block;
    transition: all 0.3s;
  }

  .exl-btn-login .exl-btn-hover-content {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: #5b21b6;
    color: #fff;
    opacity: 0;
    transition: all 0.3s;
    border-radius: 25px;
  }

  .exl-btn-login:hover:not(:disabled) .exl-btn-text {
    transform: translateX(40px);
    opacity: 0;
  }

  .exl-btn-login:hover:not(:disabled) .exl-btn-hover-content {
    opacity: 1;
  }

  /* ============ ANIMATED CHARACTERS ============ */
  .exl-characters-scene {
    position: relative;
    width: 480px;
    height: 360px;
  }

  .exl-character {
    position: absolute;
    bottom: 0;
    transition: all 0.7s ease-in-out;
    transform-origin: bottom center;
  }

  .exl-char-purple {
    left: 60px;
    width: 170px;
    height: 370px;
    background: #6c3ff5;
    border-radius: 10px 10px 0 0;
    z-index: 1;
  }

  .exl-char-black {
    left: 220px;
    width: 115px;
    height: 290px;
    background: #2d2d2d;
    border-radius: 8px 8px 0 0;
    z-index: 2;
  }

  .exl-char-orange {
    left: 0;
    width: 230px;
    height: 190px;
    background: #ff9b6b;
    border-radius: 115px 115px 0 0;
    z-index: 3;
  }

  .exl-char-yellow {
    left: 290px;
    width: 135px;
    height: 215px;
    background: #e8d754;
    border-radius: 68px 68px 0 0;
    z-index: 4;
  }

  .exl-eyes {
    position: absolute;
    display: flex;
    transition: all 0.7s ease-in-out;
  }

  .exl-eyeball {
    border-radius: 50%;
    background: white;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: height 0.15s ease;
    overflow: hidden;
  }

  .exl-pupil {
    border-radius: 50%;
    background: #2d2d2d;
    transition: transform 0.1s ease-out;
  }

  .exl-bare-pupil {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #2d2d2d;
    transition: transform 0.7s ease-in-out;
  }

  .exl-yellow-mouth {
    position: absolute;
    width: 50px;
    height: 4px;
    background: #2d2d2d;
    border-radius: 2px;
    transition: all 0.7s ease-in-out;
  }

  .exl-orange-mouth {
    position: absolute;
    width: 28px;
    height: 14px;
    border: 3px solid #2d2d2d;
    border-top: none;
    border-radius: 0 0 14px 14px;
    opacity: 0;
    transition: all 0.7s ease-in-out;
  }

  .exl-orange-mouth.exl-visible {
    opacity: 1;
  }

  /* Shake-head: smooth left-right oscillation on face parts */
  @keyframes exlShakeHead {
    0%, 100% { translate: 0 0; }
    10% { translate: -9px 0; }
    20% { translate: 7px 0; }
    30% { translate: -6px 0; }
    40% { translate: 5px 0; }
    50% { translate: -4px 0; }
    60% { translate: 3px 0; }
    70% { translate: -2px 0; }
    80% { translate: 1px 0; }
    90% { translate: -0.5px 0; }
  }

  .exl-eyes.exl-shake-head,
  .exl-yellow-mouth.exl-shake-head,
  .exl-orange-mouth.exl-shake-head {
    animation: exlShakeHead 0.8s cubic-bezier(0.36, 0.07, 0.19, 0.97) both;
  }

  /* ============ RESPONSIVE ============ */
  @media (max-width: 900px) {
    .exl-login-page {
      grid-template-columns: 1fr;
    }

    .exl-left-panel {
      display: none;
    }
  }
`;type RectPos = { faceX: number; faceY: number; bodySkew: number };
type PupilOffset = { x: number; y: number };

export default function LoginPage() {
  const router = useRouter();
  const { isAuthed } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [passwordError, setPasswordError] = useState(false);

  // ---- DOM refs（角色与五官） ----
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const purpleRef = useRef<HTMLDivElement>(null);
  const blackRef = useRef<HTMLDivElement>(null);
  const orangeRef = useRef<HTMLDivElement>(null);
  const yellowRef = useRef<HTMLDivElement>(null);

  const purpleEyesRef = useRef<HTMLDivElement>(null);
  const purpleEyeLRef = useRef<HTMLDivElement>(null);
  const purpleEyeRRef = useRef<HTMLDivElement>(null);
  const purplePupilLRef = useRef<HTMLDivElement>(null);
  const purplePupilRRef = useRef<HTMLDivElement>(null);

  const blackEyesRef = useRef<HTMLDivElement>(null);
  const blackEyeLRef = useRef<HTMLDivElement>(null);
  const blackEyeRRef = useRef<HTMLDivElement>(null);
  const blackPupilLRef = useRef<HTMLDivElement>(null);
  const blackPupilRRef = useRef<HTMLDivElement>(null);

  const orangeEyesRef = useRef<HTMLDivElement>(null);
  const orangePupilLRef = useRef<HTMLDivElement>(null);
  const orangePupilRRef = useRef<HTMLDivElement>(null);
  const orangeMouthRef = useRef<HTMLDivElement>(null);

  const yellowEyesRef = useRef<HTMLDivElement>(null);
  const yellowPupilLRef = useRef<HTMLDivElement>(null);
  const yellowPupilRRef = useRef<HTMLDivElement>(null);
  const yellowMouthRef = useRef<HTMLDivElement>(null);

  // ---- 动画可变状态（用 ref 保存，避免触发重渲染） ----
  const mountedRef = useRef(false);
  const mouse = useRef({ x: 0, y: 0 });
  const isTyping = useRef(false);
  const isLookingAtEachOther = useRef(false);
  const isPurpleBlinking = useRef(false);
  const isBlackBlinking = useRef(false);
  const isPurplePeeking = useRef(false);
  const isPasswordFocused = useRef(false);
  const isLoginError = useRef(false);
  const showPasswordRef = useRef(false);
  const typingTimer = useRef<number | null>(null);
  const errorRecoverTimer = useRef<number | null>(null);
  const blinkPurpleTimer = useRef<number | null>(null);
  const blinkBlackTimer = useRef<number | null>(null);
  const peekTimer = useRef<number | null>(null);

  // 登录成功后由 useAuth 的 isAuthed 变化自动跳转
  useEffect(() => {
    if (isAuthed) router.replace("/");
  }, [isAuthed, router]);

  // 根据鼠标位置计算角色朝向与身体倾斜
  const calcPosition = useCallback((el: HTMLElement): RectPos => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 3;
    const dx = mouse.current.x - cx;
    const dy = mouse.current.y - cy;
    const faceX = Math.max(-15, Math.min(15, dx / 20));
    const faceY = Math.max(-10, Math.min(10, dy / 30));
    const bodySkew = Math.max(-6, Math.min(6, -dx / 120));
    return { faceX, faceY, bodySkew };
  }, []);

  // 根据鼠标位置计算瞳孔偏移
  const calcPupilOffset = useCallback((el: HTMLElement, maxDist: number): PupilOffset => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = mouse.current.x - cx;
    const dy = mouse.current.y - cy;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), maxDist);
    const angle = Math.atan2(dy, dx);
    return { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist };
  }, []);

  // 核心：把每个角色的身体 / 眼睛 / 瞳孔 / 嘴巴摆到正确的姿态
  const updateCharacters = useCallback(() => {
    if (!mountedRef.current) return;
    const purple = purpleRef.current;
    const black = blackRef.current;
    const orange = orangeRef.current;
    const yellow = yellowRef.current;
    if (!purple || !black || !orange || !yellow) return;

    const purplePos = calcPosition(purple);
    const blackPos = calcPosition(black);
    const orangePos = calcPosition(orange);
    const yellowPos = calcPosition(yellow);

    const pwdLen = passwordRef.current?.value.length ?? 0;
    const isShowingPwd = pwdLen > 0 && showPasswordRef.current;
    // 密码框聚焦（且未显示密码）时，角色转头回避
    const isLookingAway = isPasswordFocused.current && !showPasswordRef.current;

    // ---- Purple body ----
    if (isShowingPwd) {
      purple.style.transform = "skewX(0deg)";
      purple.style.height = "370px";
    } else if (isLookingAway) {
      purple.style.transform = "skewX(-14deg) translateX(-20px)";
      purple.style.height = "410px";
    } else if (isTyping.current) {
      purple.style.transform = `skewX(${(purplePos.bodySkew || 0) - 12}deg) translateX(40px)`;
      purple.style.height = "410px";
    } else {
      purple.style.transform = `skewX(${purplePos.bodySkew}deg)`;
      purple.style.height = "370px";
    }

    // Purple eyes
    const purpleEyes = purpleEyesRef.current;
    const purpleEyeL = purpleEyeLRef.current;
    const purpleEyeR = purpleEyeRRef.current;
    const purplePupilL = purplePupilLRef.current;
    const purplePupilR = purplePupilRRef.current;
    if (purpleEyes && purpleEyeL && purpleEyeR && purplePupilL && purplePupilR) {
      purpleEyeL.style.height = isPurpleBlinking.current ? "2px" : "18px";
      purpleEyeR.style.height = isPurpleBlinking.current ? "2px" : "18px";

      if (isLoginError.current) {
        purpleEyes.style.left = "30px";
        purpleEyes.style.top = "55px";
        purplePupilL.style.transform = "translate(-3px, 4px)";
        purplePupilR.style.transform = "translate(-3px, 4px)";
      } else if (isLookingAway) {
        purpleEyes.style.left = "20px";
        purpleEyes.style.top = "25px";
        purplePupilL.style.transform = "translate(-5px, -5px)";
        purplePupilR.style.transform = "translate(-5px, -5px)";
      } else if (isShowingPwd) {
        purpleEyes.style.left = "20px";
        purpleEyes.style.top = "35px";
        const px = isPurplePeeking.current ? 4 : -4;
        const py = isPurplePeeking.current ? 5 : -4;
        purplePupilL.style.transform = `translate(${px}px, ${py}px)`;
        purplePupilR.style.transform = `translate(${px}px, ${py}px)`;
      } else if (isLookingAtEachOther.current) {
        purpleEyes.style.left = "55px";
        purpleEyes.style.top = "65px";
        purplePupilL.style.transform = "translate(3px, 4px)";
        purplePupilR.style.transform = "translate(3px, 4px)";
      } else {
        purpleEyes.style.left = 45 + purplePos.faceX + "px";
        purpleEyes.style.top = 40 + purplePos.faceY + "px";
        const po = calcPupilOffset(purpleEyeL, 5);
        purplePupilL.style.transform = `translate(${po.x}px, ${po.y}px)`;
        purplePupilR.style.transform = `translate(${po.x}px, ${po.y}px)`;
      }
    }

    // ---- Black body ----
    if (isShowingPwd) {
      black.style.transform = "skewX(0deg)";
    } else if (isLookingAway) {
      black.style.transform = "skewX(12deg) translateX(-10px)";
    } else if (isLookingAtEachOther.current) {
      black.style.transform = `skewX(${(blackPos.bodySkew || 0) * 1.5 + 10}deg) translateX(20px)`;
    } else if (isTyping.current) {
      black.style.transform = `skewX(${(blackPos.bodySkew || 0) * 1.5}deg)`;
    } else {
      black.style.transform = `skewX(${blackPos.bodySkew}deg)`;
    }

    // Black eyes
    const blackEyes = blackEyesRef.current;
    const blackEyeL = blackEyeLRef.current;
    const blackEyeR = blackEyeRRef.current;
    const blackPupilL = blackPupilLRef.current;
    const blackPupilR = blackPupilRRef.current;
    if (blackEyes && blackEyeL && blackEyeR && blackPupilL && blackPupilR) {
      blackEyeL.style.height = isBlackBlinking.current ? "2px" : "16px";
      blackEyeR.style.height = isBlackBlinking.current ? "2px" : "16px";

      if (isLoginError.current) {
        blackEyes.style.left = "15px";
        blackEyes.style.top = "40px";
        blackPupilL.style.transform = "translate(-3px, 4px)";
        blackPupilR.style.transform = "translate(-3px, 4px)";
      } else if (isLookingAway) {
        blackEyes.style.left = "10px";
        blackEyes.style.top = "20px";
        blackPupilL.style.transform = "translate(-4px, -5px)";
        blackPupilR.style.transform = "translate(-4px, -5px)";
      } else if (isShowingPwd) {
        blackEyes.style.left = "10px";
        blackEyes.style.top = "28px";
        blackPupilL.style.transform = "translate(-4px, -4px)";
        blackPupilR.style.transform = "translate(-4px, -4px)";
      } else if (isLookingAtEachOther.current) {
        blackEyes.style.left = "32px";
        blackEyes.style.top = "12px";
        blackPupilL.style.transform = "translate(0px, -4px)";
        blackPupilR.style.transform = "translate(0px, -4px)";
      } else {
        blackEyes.style.left = 26 + blackPos.faceX + "px";
        blackEyes.style.top = 32 + blackPos.faceY + "px";
        const bo = calcPupilOffset(blackEyeL, 4);
        blackPupilL.style.transform = `translate(${bo.x}px, ${bo.y}px)`;
        blackPupilR.style.transform = `translate(${bo.x}px, ${bo.y}px)`;
      }
    }

    // ---- Orange body ----
    const orangeMouth = orangeMouthRef.current;
    if (orangeMouth && isLoginError.current) {
      orangeMouth.style.left = 80 + orangePos.faceX + "px";
      orangeMouth.style.top = "130px";
    }
    if (isShowingPwd) {
      orange.style.transform = "skewX(0deg)";
    } else {
      orange.style.transform = `skewX(${orangePos.bodySkew}deg)`;
    }

    // Orange eyes
    const orangeEyes = orangeEyesRef.current;
    const orangePupilL = orangePupilLRef.current;
    const orangePupilR = orangePupilRRef.current;
    if (orangeEyes && orangePupilL && orangePupilR) {
      if (isLoginError.current) {
        orangeEyes.style.left = "60px";
        orangeEyes.style.top = "95px";
        orangePupilL.style.transform = "translate(-3px, 4px)";
        orangePupilR.style.transform = "translate(-3px, 4px)";
      } else if (isLookingAway) {
        orangeEyes.style.left = "50px";
        orangeEyes.style.top = "75px";
        orangePupilL.style.transform = "translate(-5px, -5px)";
        orangePupilR.style.transform = "translate(-5px, -5px)";
      } else if (isShowingPwd) {
        orangeEyes.style.left = "50px";
        orangeEyes.style.top = "85px";
        orangePupilL.style.transform = "translate(-5px, -4px)";
        orangePupilR.style.transform = "translate(-5px, -4px)";
      } else {
        orangeEyes.style.left = 82 + orangePos.faceX + "px";
        orangeEyes.style.top = 90 + orangePos.faceY + "px";
        const oo = calcPupilOffset(orangePupilL, 5);
        orangePupilL.style.transform = `translate(${oo.x}px, ${oo.y}px)`;
        orangePupilR.style.transform = `translate(${oo.x}px, ${oo.y}px)`;
      }
    }

    // ---- Yellow body ----
    if (isShowingPwd) {
      yellow.style.transform = "skewX(0deg)";
    } else {
      yellow.style.transform = `skewX(${yellowPos.bodySkew}deg)`;
    }

    // Yellow eyes & mouth
    const yellowEyes = yellowEyesRef.current;
    const yellowPupilL = yellowPupilLRef.current;
    const yellowPupilR = yellowPupilRRef.current;
    const yellowMouth = yellowMouthRef.current;
    if (yellowEyes && yellowPupilL && yellowPupilR && yellowMouth) {
      if (isLoginError.current) {
        yellowEyes.style.left = "35px";
        yellowEyes.style.top = "45px";
        yellowPupilL.style.transform = "translate(-3px, 4px)";
        yellowPupilR.style.transform = "translate(-3px, 4px)";
        yellowMouth.style.left = "30px";
        yellowMouth.style.top = "92px";
        yellowMouth.style.transform = "rotate(-8deg)";
      } else if (isLookingAway) {
        yellowEyes.style.left = "20px";
        yellowEyes.style.top = "30px";
        yellowPupilL.style.transform = "translate(-5px, -5px)";
        yellowPupilR.style.transform = "translate(-5px, -5px)";
        yellowMouth.style.left = "15px";
        yellowMouth.style.top = "78px";
        yellowMouth.style.transform = "rotate(0deg)";
      } else if (isShowingPwd) {
        yellowEyes.style.left = "20px";
        yellowEyes.style.top = "35px";
        yellowPupilL.style.transform = "translate(-5px, -4px)";
        yellowPupilR.style.transform = "translate(-5px, -4px)";
        yellowMouth.style.left = "10px";
        yellowMouth.style.top = "88px";
        yellowMouth.style.transform = "rotate(0deg)";
      } else {
        yellowEyes.style.left = 52 + yellowPos.faceX + "px";
        yellowEyes.style.top = 40 + yellowPos.faceY + "px";
        const yo = calcPupilOffset(yellowPupilL, 5);
        yellowPupilL.style.transform = `translate(${yo.x}px, ${yo.y}px)`;
        yellowPupilR.style.transform = `translate(${yo.x}px, ${yo.y}px)`;
        yellowMouth.style.left = 40 + yellowPos.faceX + "px";
        yellowMouth.style.top = 88 + yellowPos.faceY + "px";
        yellowMouth.style.transform = "rotate(0deg)";
      }
    }
  }, [calcPosition, calcPupilOffset]);  // 输入邮箱时互相对视，停止输入 800ms 后恢复
  const setTyping = useCallback(
    (typing: boolean) => {
      isTyping.current = typing;
      if (typing) {
        isLookingAtEachOther.current = true;
        if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
        typingTimer.current = window.setTimeout(() => {
          isLookingAtEachOther.current = false;
          updateCharacters();
        }, 800);
      } else {
        isLookingAtEachOther.current = false;
      }
      updateCharacters();
    },
    [updateCharacters],
  );

  // 显示密码时紫色角色周期性“偷看”
  const schedulePeek = useCallback(() => {
    if ((passwordRef.current?.value.length ?? 0) > 0 && showPasswordRef.current) {
      peekTimer.current = window.setTimeout(() => {
        if ((passwordRef.current?.value.length ?? 0) > 0 && showPasswordRef.current) {
          isPurplePeeking.current = true;
          updateCharacters();
          peekTimer.current = window.setTimeout(() => {
            isPurplePeeking.current = false;
            updateCharacters();
            schedulePeek();
          }, 800);
        }
      }, Math.random() * 3000 + 2000);
    }
  }, [updateCharacters]);

  // 登录失败：角色摇头 + 橙色悲伤嘴，2.5 秒后恢复
  const triggerLoginError = useCallback(() => {
    if (errorRecoverTimer.current !== null) {
      window.clearTimeout(errorRecoverTimer.current);
      errorRecoverTimer.current = null;
    }

    const shakeEls = [
      purpleEyesRef.current,
      blackEyesRef.current,
      orangeEyesRef.current,
      yellowEyesRef.current,
      yellowMouthRef.current,
      orangeMouthRef.current,
    ].filter((el): el is HTMLDivElement => el !== null);

    // 重置动画（移除 class，强制 reflow 后重新添加，支持重复点击）
    shakeEls.forEach((el) => el.classList.remove("exl-shake-head"));
    void document.body.offsetHeight;

    isLoginError.current = true;
    isPasswordFocused.current = false;
    updateCharacters();

    // 显示橙色悲伤嘴
    orangeMouthRef.current?.classList.add("exl-visible");

    // 等身体过渡（0.7s）稳定后开始摇头
    window.setTimeout(() => {
      shakeEls.forEach((el) => el.classList.add("exl-shake-head"));
    }, 350);

    // 2.5 秒后恢复
    errorRecoverTimer.current = window.setTimeout(() => {
      isLoginError.current = false;
      errorRecoverTimer.current = null;
      orangeMouthRef.current?.classList.remove("exl-visible");
      shakeEls.forEach((el) => el.classList.remove("exl-shake-head"));
      updateCharacters();
    }, 2500);
  }, [updateCharacters]);

  // 挂载：鼠标跟随、输入框事件、眨眼调度、初始姿态；卸载：清理所有监听与定时器
  useEffect(() => {
    mountedRef.current = true;

    const onMouseMove = (e: MouseEvent) => {
      mouse.current.x = e.clientX;
      mouse.current.y = e.clientY;
      if (!isTyping.current && !isLoginError.current) updateCharacters();
    };
    document.addEventListener("mousemove", onMouseMove);

    const emailEl = emailRef.current;
    const passwordEl = passwordRef.current;

    const onEmailFocus = () => setTyping(true);
    const onEmailBlur = () => setTyping(false);
    const onEmailInput = () => updateCharacters();
    const onPasswordFocus = () => {
      isPasswordFocused.current = true;
      updateCharacters();
    };
    const onPasswordBlur = () => {
      isPasswordFocused.current = false;
      updateCharacters();
    };
    const onPasswordInput = () => updateCharacters();

    emailEl?.addEventListener("focus", onEmailFocus);
    emailEl?.addEventListener("blur", onEmailBlur);
    emailEl?.addEventListener("input", onEmailInput);
    passwordEl?.addEventListener("focus", onPasswordFocus);
    passwordEl?.addEventListener("blur", onPasswordBlur);
    passwordEl?.addEventListener("input", onPasswordInput);

    // 紫黑角色随机眨眼（3~7 秒一次，递归调度）
    const scheduleBlinkPurple = () => {
      if (!mountedRef.current) return;
      blinkPurpleTimer.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        isPurpleBlinking.current = true;
        updateCharacters();
        blinkPurpleTimer.current = window.setTimeout(() => {
          if (!mountedRef.current) return;
          isPurpleBlinking.current = false;
          updateCharacters();
          scheduleBlinkPurple();
        }, 150);
      }, Math.random() * 4000 + 3000);
    };

    const scheduleBlinkBlack = () => {
      if (!mountedRef.current) return;
      blinkBlackTimer.current = window.setTimeout(() => {
        if (!mountedRef.current) return;
        isBlackBlinking.current = true;
        updateCharacters();
        blinkBlackTimer.current = window.setTimeout(() => {
          if (!mountedRef.current) return;
          isBlackBlinking.current = false;
          updateCharacters();
          scheduleBlinkBlack();
        }, 150);
      }, Math.random() * 4000 + 3000);
    };

    scheduleBlinkPurple();
    scheduleBlinkBlack();

    // 初始姿态
    updateCharacters();

    return () => {
      mountedRef.current = false;
      document.removeEventListener("mousemove", onMouseMove);
      emailEl?.removeEventListener("focus", onEmailFocus);
      emailEl?.removeEventListener("blur", onEmailBlur);
      emailEl?.removeEventListener("input", onEmailInput);
      passwordEl?.removeEventListener("focus", onPasswordFocus);
      passwordEl?.removeEventListener("blur", onPasswordBlur);
      passwordEl?.removeEventListener("input", onPasswordInput);
      if (typingTimer.current !== null) window.clearTimeout(typingTimer.current);
      if (errorRecoverTimer.current !== null) window.clearTimeout(errorRecoverTimer.current);
      if (blinkPurpleTimer.current !== null) window.clearTimeout(blinkPurpleTimer.current);
      if (blinkBlackTimer.current !== null) window.clearTimeout(blinkBlackTimer.current);
      if (peekTimer.current !== null) window.clearTimeout(peekTimer.current);
      typingTimer.current = null;
      errorRecoverTimer.current = null;
      blinkPurpleTimer.current = null;
      blinkBlackTimer.current = null;
      peekTimer.current = null;
    };
  }, [setTyping, updateCharacters]);  const handleTogglePassword = () => {
    const next = !showPasswordRef.current;
    showPasswordRef.current = next;
    setShowPassword(next);
    updateCharacters();
    if (next) schedulePeek();
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setEmailError(false);
    setPasswordError(false);

    const emailValue = email.trim();
    const pwdValue = password;

    // 客户端校验（与原页面一致）
    if (!emailValue || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      setEmailError(true);
      setError("请输入有效的邮箱地址。");
      triggerLoginError();
      return;
    }
    if (!pwdValue || pwdValue.length < 6) {
      setPasswordError(true);
      setError("密码至少需要 6 个字符。");
      triggerLoginError();
      return;
    }

    setBusy(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: emailValue,
      password: pwdValue,
    });
    setBusy(false);
    if (signInError) {
      setPasswordError(true);
      setError(
        signInError.message === "Invalid login credentials"
          ? "邮箱或密码错误，请重试。"
          : signInError.message,
      );
      triggerLoginError();
    }
  }

  return (
    <>
      <style>{LOGIN_STYLES}</style>
      <div className="exl-login-page">
        {/* ============ LEFT PANEL：角色 ============ */}
        <div className="exl-left-panel">
          <div className="exl-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M12 2L15 9H9L12 2Z" />
              <path d="M12 22L9 15H15L12 22Z" />
              <path d="M2 12L9 9V15L2 12Z" />
              <path d="M22 12L15 15V9L22 12Z" />
            </svg>
            <span>Ex-Lend</span>
          </div>

          <div className="exl-characters-wrapper">
            <div className="exl-characters-scene">
              {/* 紫色角色 */}
              <div className="exl-character exl-char-purple" ref={purpleRef}>
                <div
                  className="exl-eyes"
                  ref={purpleEyesRef}
                  style={{ left: "45px", top: "40px", gap: "28px" }}
                >
                  <div className="exl-eyeball" ref={purpleEyeLRef} style={{ width: "18px", height: "18px" }}>
                    <div className="exl-pupil" ref={purplePupilLRef} style={{ width: "7px", height: "7px" }} />
                  </div>
                  <div className="exl-eyeball" ref={purpleEyeRRef} style={{ width: "18px", height: "18px" }}>
                    <div className="exl-pupil" ref={purplePupilRRef} style={{ width: "7px", height: "7px" }} />
                  </div>
                </div>
              </div>

              {/* 黑色角色 */}
              <div className="exl-character exl-char-black" ref={blackRef}>
                <div
                  className="exl-eyes"
                  ref={blackEyesRef}
                  style={{ left: "26px", top: "32px", gap: "20px" }}
                >
                  <div className="exl-eyeball" ref={blackEyeLRef} style={{ width: "16px", height: "16px" }}>
                    <div className="exl-pupil" ref={blackPupilLRef} style={{ width: "6px", height: "6px" }} />
                  </div>
                  <div className="exl-eyeball" ref={blackEyeRRef} style={{ width: "16px", height: "16px" }}>
                    <div className="exl-pupil" ref={blackPupilRRef} style={{ width: "6px", height: "6px" }} />
                  </div>
                </div>
              </div>

              {/* 橙色角色（半圆 + 悲伤嘴） */}
              <div className="exl-character exl-char-orange" ref={orangeRef}>
                <div
                  className="exl-eyes"
                  ref={orangeEyesRef}
                  style={{ left: "82px", top: "90px", gap: "28px" }}
                >
                  <div className="exl-bare-pupil" ref={orangePupilLRef} />
                  <div className="exl-bare-pupil" ref={orangePupilRRef} />
                </div>
                <div className="exl-orange-mouth" ref={orangeMouthRef} style={{ left: "90px", top: "120px" }} />
              </div>

              {/* 黄色角色（圆角矩形 + 嘴巴） */}
              <div className="exl-character exl-char-yellow" ref={yellowRef}>
                <div
                  className="exl-eyes"
                  ref={yellowEyesRef}
                  style={{ left: "52px", top: "40px", gap: "20px" }}
                >
                  <div className="exl-bare-pupil" ref={yellowPupilLRef} />
                  <div className="exl-bare-pupil" ref={yellowPupilRRef} />
                </div>
                <div className="exl-yellow-mouth" ref={yellowMouthRef} style={{ left: "40px", top: "88px" }} />
              </div>
            </div>
          </div>

          {/* 底部占位，保持与原版一致的纵向节奏 */}
          <div className="exl-footer-links" aria-hidden="true" />
        </div>

        {/* ============ RIGHT PANEL：表单 ============ */}
        <div className="exl-right-panel">
          <div className="exl-form-container">
            <div className="exl-sparkle-icon">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L13.5 9H10.5L12 2Z" fill="#1a1a2e" />
                <path d="M12 22L10.5 15H13.5L12 22Z" fill="#1a1a2e" />
                <path d="M2 12L9 10.5V13.5L2 12Z" fill="#1a1a2e" />
                <path d="M22 12L15 13.5V10.5L22 12Z" fill="#1a1a2e" />
              </svg>
            </div>

            <div className="exl-form-header">
              <h1>欢迎回来</h1>
              <p>请输入你的账号信息</p>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div className="exl-form-group">
                <label htmlFor="email" className={emailError ? "exl-error-label" : ""}>
                  邮箱
                </label>
                <div className="exl-input-wrapper">
                  <input
                    ref={emailRef}
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={emailError ? "exl-error" : ""}
                  />
                </div>
              </div>

              <div className="exl-form-group">
                <label htmlFor="password" className={passwordError ? "exl-error-label" : ""}>
                  密码
                </label>
                <div className="exl-input-wrapper">
                  <input
                    ref={passwordRef}
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={passwordError ? "exl-error" : ""}
                  />
                  <button
                    type="button"
                    className="exl-toggle-password"
                    onClick={handleTogglePassword}
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  >
                    {showPassword ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {error && <div className="exl-error-msg">{error}</div>}

              <button type="submit" className="exl-btn-login" disabled={busy}>
                <span className="exl-btn-text">{busy ? "登录中…" : "登录"}</span>
                <span className="exl-btn-hover-content">
                  <span>登录</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
export const adminIdentityStyle = String.raw`
/* Cashu Card identity: original mascot, precise typography, physical card study. */
.brand {
  gap: 11px;
  letter-spacing: 0;
  font-weight: 500;
}
.brand-mark {
  position: relative;
  width: 39px;
  height: 44px;
  border-radius: 0;
  background: none;
  flex-shrink: 0;
  isolation: isolate;
}
.brand-mark:before {
  content: "";
  position: absolute;
  inset: 0;
  border: 1px solid #c7f58c45;
  border-radius: 10px;
  transform: rotate(-9deg);
  background: linear-gradient(145deg, #c7f58c12, #c7f58c03);
  transition:
    transform 0.35s,
    border-color 0.35s;
}
.brand-mark img {
  position: relative;
  width: 28px;
  height: 32px;
  object-fit: contain;
  image-rendering: pixelated;
  transform: rotate(-9deg);
  transition: transform 0.35s;
}
.brand-corner {
  position: absolute;
  right: -2px;
  bottom: 2px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #c7f58c;
  box-shadow: 0 0 0 3px #13291e;
}
.brand:hover .brand-mark:before,
.brand:hover .brand-mark img {
  transform: rotate(0);
  border-color: #c7f58c99;
}
.brand-name {
  display: block;
  font-size: 25px;
  font-weight: 650;
  line-height: 1.05;
  letter-spacing: -1.2px;
}
.brand-name > span {
  font-weight: 400;
  color: #c7f58c;
}
.brand small {
  font-size: 8px;
  font-weight: 500;
  letter-spacing: 1.45px;
  opacity: 0.65;
  margin-top: 7px;
  text-transform: uppercase;
}
.sidebar .brand {
  padding: 0 5px;
  margin-bottom: 43px;
}
.sidebar .brand-mark {
  width: 35px;
  height: 40px;
}
.sidebar .brand-name {
  font-size: 24px;
}
.sidebar .brand small {
  font-size: 7px;
  letter-spacing: 1.2px;
}
.mobile-brand .brand-mark {
  background: none;
  width: 28px;
  height: 33px;
}
.mobile-brand .brand-mark img {
  width: 22px;
  height: 25px;
}
.mobile-wordmark {
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -1px;
}
.mobile-wordmark > span {
  font-weight: 400;
  color: #577847;
}
.login-layout {
  grid-template-columns: minmax(0, 1.22fr) minmax(390px, 1fr);
  padding: 12px;
  gap: 0;
  background: #eeeee7;
}
.login-story {
  min-height: calc(100svh - 24px);
  border-radius: 15px;
  background: #11251c;
  padding: 34px 40px 24px;
  isolation: isolate;
}
.login-story:before {
  width: 1000px;
  height: 1000px;
  top: 10%;
  right: -450px;
  background: radial-gradient(ellipse, #5d8d4f2b, transparent 62%);
  z-index: -1;
}
.login-story:after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  opacity: 0.12;
  background-image:
    linear-gradient(#9db88f22 1px, transparent 1px),
    linear-gradient(90deg, #9db88f22 1px, transparent 1px);
  background-size: 64px 64px;
  mask-image: linear-gradient(transparent, #000 60%, transparent);
}
.story-top {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: center;
}
.edition {
  font-family: ui-monospace, monospace;
  font-size: 9px;
  letter-spacing: 1px;
  color: #819681;
  border: 1px solid #a2bd8d26;
  border-radius: 30px;
  padding: 9px 12px;
}
.story-content {
  max-width: none;
  padding: 52px 0 0;
}
.story-kicker {
  display: flex;
  align-items: center;
  gap: 10px;
  font-family: ui-monospace, monospace;
  letter-spacing: 1.8px;
  font-size: 9px !important;
  color: #a9bf98 !important;
  margin: 0 0 22px !important;
}
.story-kicker > span {
  height: 5px;
  width: 5px;
  border-radius: 50%;
  background: #c7f58c;
  box-shadow: 0 0 14px #b2ed7580;
}
.story-content h1 {
  font-size: clamp(45px, 4.4vw, 76px);
  font-weight: 450;
  letter-spacing: -3.2px;
  line-height: 1.04;
  margin-bottom: 23px;
}
.story-content h1 span {
  color: #c8dcba;
}
.story-description {
  font-size: 13px !important;
  line-height: 1.8 !important;
  max-width: 420px !important;
  color: #95ab94 !important;
  margin-bottom: 0;
}
.card-scene {
  height: 310px;
  position: relative;
  margin: 0 -15px;
  perspective: 1200px;
}
.scene-orbit {
  position: absolute;
  border: 1px solid #a6c68f1c;
  border-radius: 50%;
  width: 410px;
  height: 260px;
  left: 50%;
  top: 42%;
  transform: translate(-50%, -50%) rotate(-25deg);
}
.orbit-two {
  width: 540px;
  height: 310px;
  transform: translate(-50%, -50%) rotate(-25deg);
}
.hero-card,
.card-underlay {
  position: absolute;
  left: 50%;
  top: 48%;
  width: 304px;
  height: 187px;
  border-radius: 15px;
  transform: translate(-50%, -50%) rotate(-12deg);
  transform-style: preserve-3d;
}
.hero-card {
  overflow: hidden;
  background: linear-gradient(120deg, #d8e7be, #b3c98f 48%, #d3e2bc);
  border: 1px solid #ebf4d7b0;
  box-shadow:
    0 25px 40px #0005,
    0 1px 0 #fff8 inset;
  color: #203724;
  padding: 23px;
  animation: card-arrive 1.3s cubic-bezier(0.16, 1, 0.3, 1) both;
  transition:
    transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 0.6s;
}
.card-scene:hover .hero-card {
  transform: translate(-50%, -55%) rotate(-7deg) rotateY(-8deg);
  box-shadow: 0 34px 55px #0006;
}
.card-underlay {
  background: linear-gradient(130deg, #1d3c2c, #183222);
  border: 1px solid #8baf7140;
  transform: translate(-43%, -40%) rotate(6deg);
  box-shadow: 0 15px 35px #0003;
  animation: underlay-arrive 1.4s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.card-underlay span {
  position: absolute;
  bottom: 14px;
  right: 18px;
  font:
    7px ui-monospace,
    monospace;
  letter-spacing: 1.4px;
  color: #8eac7c;
}
.card-foil {
  position: absolute;
  inset: 0;
  background: linear-gradient(110deg, transparent 20%, #fff6 40%, #fff0 57%);
  transform: translateX(-130%);
  animation: foil-pass 1.6s 0.45s ease-out both;
  pointer-events: none;
}
.card-topline {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-wordmark {
  font-size: 23px;
  font-weight: 650;
  letter-spacing: -1.2px;
}
.card-wordmark > span {
  font-weight: 400;
}
.card-topline svg {
  width: 20px;
  height: 20px;
  opacity: 0.65;
  stroke-width: 1.3;
}
.card-chip {
  position: absolute;
  left: 25px;
  top: 76px;
  width: 33px;
  height: 26px;
  border-radius: 5px;
  border: 1px solid #68795566;
  background: linear-gradient(135deg, #e0d5ad, #c1bd98);
  overflow: hidden;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
}
.card-chip i {
  border-right: 1px solid #68795566;
}
.card-chip:after {
  content: "";
  position: absolute;
  inset: 8px -1px;
  border-block: 1px solid #68795566;
}
.card-mascot {
  position: absolute;
  width: 97px;
  height: 111px;
  object-fit: contain;
  right: 29px;
  top: 47px;
  image-rendering: pixelated;
  filter: drop-shadow(0 7px 5px #4c603b20);
  transform: rotate(7deg);
}
.card-baseline {
  position: absolute;
  bottom: 19px;
  left: 24px;
  right: 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font:
    7px ui-monospace,
    monospace;
  letter-spacing: 1.4px;
}
.card-symbol {
  font-size: 22px;
  font-weight: 300;
}
.scene-label {
  position: absolute;
  font:
    8px ui-monospace,
    monospace;
  letter-spacing: 1.4px;
  color: #8da480;
}
.label-top {
  left: 11%;
  top: 29px;
}
.label-bottom {
  right: 0;
  bottom: 49px;
  writing-mode: vertical-rl;
  font-size: 7px;
}
.scene-cross {
  position: absolute;
  color: #8ba27680;
  font:
    19px ui-monospace,
    monospace;
}
.cross-one {
  top: 38px;
  right: 13%;
}
.cross-two {
  bottom: 36px;
  left: 13%;
}
.scene-caption {
  position: absolute;
  bottom: 3px;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 9px;
  color: #8da480;
}
.caption-line {
  width: 23px;
  height: 1px;
  background: #8da48066;
}
.story-footer {
  font:
    8px ui-monospace,
    monospace;
  letter-spacing: 1.1px;
  color: #8a9f82;
  padding-top: 29px;
  margin-top: 20px;
  border-top: 1px solid #9db88f26;
}
.footer-arrow {
  font-size: 14px;
  color: #c7f58c;
  margin-left: 10px;
}
.login-side {
  padding: 50px 45px;
  background: #eeeee7;
}
.login-card {
  max-width: 350px;
  animation: form-arrive 0.7s 0.12s both;
}
.login-card .eyebrow {
  font:
    9px ui-monospace,
    monospace;
  letter-spacing: 1.5px;
  color: #66775c;
  margin-bottom: 24px;
}
.login-card h2 {
  font-weight: 500;
  font-size: 40px;
  letter-spacing: -1.7px;
  line-height: 1.1;
  margin-bottom: 15px;
}
.login-description {
  font-size: 13px;
  margin-bottom: 36px;
}
.login-card .field {
  font-size: 11px;
  gap: 10px;
  margin-bottom: 24px;
}
.login-card .field input {
  min-height: 51px;
  border-radius: 9px;
  background: #f8f9f4;
  border-color: #d7ddcf;
  padding-inline: 15px;
  transition:
    background 0.2s,
    border-color 0.2s,
    box-shadow 0.2s;
}
.login-card .field input:focus {
  background: #fff;
  border-color: #68885a;
  box-shadow: 0 0 0 4px #6e944815;
}
.login-card .password-wrap input {
  padding-right: 49px;
}
.login-card .password-wrap .icon-btn {
  top: 8px;
}
.login-card .btn-primary {
  min-height: 51px;
  background: #1e3b29;
  box-shadow: 0 5px 14px #1e3b2915;
  justify-content: space-between;
  padding-inline: 18px;
}
.login-card .btn-primary svg {
  transition: transform 0.25s;
}
.login-card .btn-primary:hover svg {
  transform: translateX(4px);
}
.login-footnote {
  border-color: #d7ddcf;
  font-size: 10px;
  line-height: 1.85;
  margin-top: 30px;
  padding-top: 23px;
  max-width: 335px;
}
.login-footnote strong {
  font-size: 10px;
  margin-bottom: 3px;
}
.login-mobile-brand .brand-name {
  color: #203724;
}
.login-mobile-brand .brand-name > span {
  color: #647e4e;
}
.login-mobile-brand .brand-corner {
  box-shadow: 0 0 0 3px #eeeee7;
  background: #597f3d;
}
.login-mobile-brand .brand-mark:before {
  border-color: #52773c55;
  background: #c7d4b322;
}
.login-mobile-brand small {
  color: #53644a;
}
@keyframes card-arrive {
  from {
    opacity: 0;
    transform: translate(-50%, -35%) rotate(-20deg) rotateY(-18deg);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) rotate(-12deg);
  }
}
@keyframes underlay-arrive {
  from {
    opacity: 0;
    transform: translate(-50%, -45%) rotate(-12deg);
  }
  to {
    opacity: 1;
    transform: translate(-43%, -40%) rotate(6deg);
  }
}
@keyframes foil-pass {
  to {
    transform: translateX(130%);
  }
}
@keyframes form-arrive {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (min-width: 1600px) {
  .login-story {
    padding: 45px 60px 30px;
  }
  .story-content {
    padding-top: 65px;
  }
  .card-scene {
    height: 370px;
  }
  .hero-card,
  .card-underlay {
    width: 350px;
    height: 215px;
  }
  .card-mascot {
    width: 115px;
    height: 132px;
  }
  .card-chip {
    top: 90px;
  }
  .card-baseline {
    bottom: 22px;
  }
}
@media (max-width: 1150px) {
  .sidebar .brand {
    padding: 0;
    gap: 8px;
  }
  .sidebar .brand-name {
    font-size: 21px;
  }
  .sidebar .brand small {
    font-size: 6px;
    letter-spacing: 1px;
  }
  .login-story {
    padding: 30px;
  }
  .story-content h1 {
    font-size: 53px;
    letter-spacing: -2.6px;
  }
  .edition {
    display: none;
  }
  .login-side {
    padding: 40px 30px;
  }
  .card-scene {
    margin-inline: -15px;
  }
  .hero-card,
  .card-underlay {
    width: 270px;
    height: 168px;
  }
  .card-mascot {
    width: 82px;
    height: 94px;
  }
  .card-chip {
    top: 67px;
  }
  .label-top {
    left: 6%;
  }
  .label-bottom {
    right: 0;
  }
}
@media (max-width: 850px) {
  .sidebar .brand {
    padding: 0 6px;
  }
  .login-layout {
    grid-template-columns: minmax(0, 1fr) minmax(330px, 1fr);
  }
  .login-story {
    padding: 25px;
  }
  .login-story .brand-name {
    font-size: 23px;
  }
  .story-content {
    padding-top: 40px;
  }
  .story-content h1 {
    font-size: 43px;
    letter-spacing: -2px;
  }
  .story-description {
    font-size: 11px !important;
  }
  .hero-card,
  .card-underlay {
    width: 220px;
    height: 140px;
    border-radius: 12px;
  }
  .hero-card {
    padding: 17px;
  }
  .card-wordmark {
    font-size: 19px;
  }
  .card-mascot {
    width: 68px;
    height: 78px;
    top: 37px;
    right: 18px;
  }
  .card-chip {
    left: 18px;
    top: 58px;
    width: 27px;
    height: 21px;
  }
  .card-baseline {
    left: 18px;
    right: 18px;
    bottom: 13px;
    font-size: 6px;
  }
  .card-scene {
    height: 275px;
  }
  .scene-orbit {
    width: 300px;
    height: 210px;
  }
  .orbit-two {
    width: 390px;
    height: 260px;
  }
  .scene-label {
    font-size: 7px;
  }
  .label-bottom {
    display: none;
  }
  .scene-caption {
    font-size: 8px;
  }
  .login-card h2 {
    font-size: 35px;
  }
  .login-card .eyebrow {
    font-size: 8px;
    letter-spacing: 1px;
  }
}
@media (max-width: 600px) {
  .login-layout {
    padding: 0;
    display: block;
  }
  .login-side {
    padding: 40px 28px;
    min-height: 100svh;
  }
  .login-card {
    max-width: 380px;
  }
  .login-mobile-brand {
    margin-bottom: 64px;
    gap: 13px;
  }
  .login-mobile-brand .brand-mark {
    width: 42px;
    height: 47px;
  }
  .login-mobile-brand .brand-mark img {
    width: 32px;
    height: 37px;
  }
  .login-mobile-brand .brand-name {
    font-size: 32px;
    letter-spacing: -1.7px;
  }
  .login-mobile-brand small {
    font-size: 8px;
    letter-spacing: 1.8px;
  }
  .login-card h2 {
    font-size: 39px;
  }
  .login-description {
    font-size: 12px;
  }
  .login-card .eyebrow {
    font-size: 9px;
  }
  .login-footnote {
    max-width: none;
  }
  .mobile-brand {
    gap: 10px;
  }
  .mobile-brand .brand-corner {
    display: none;
  }
}
`;

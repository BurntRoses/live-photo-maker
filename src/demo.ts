/** Original vector scene, authored for this project; contains no reference photographs. */
export function demoFile(): File {
  return new File([`<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440" viewBox="0 0 1080 1440">
  <defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#d8e4dc"/><stop offset=".65" stop-color="#b9d5cc"/><stop offset="1" stop-color="#e2dbc5"/></linearGradient><linearGradient id="water" x2=".3" y2="1"><stop stop-color="#9fbcb0"/><stop offset="1" stop-color="#455f54"/></linearGradient><linearGradient id="leaf" x2="1" y2="1"><stop stop-color="#425a36"/><stop offset="1" stop-color="#74865a"/></linearGradient><filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".5" numOctaves="3" seed="17"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".07"/></feComponentTransfer><feBlend in="SourceGraphic" mode="multiply"/></filter></defs>
  <g filter="url(#paper)"><path fill="url(#sky)" d="M0 0h1080v1440H0z"/><circle cx="800" cy="286" r="65" fill="#edf0cf" opacity=".85"/>
  <path d="M0 601 128 419 265 520 420 318 602 486 762 350 1080 609V1010H0" fill="#a7b9a0"/><path d="m0 742 185-217 153 103 169-102 162 185 174-171 237 148v420H0" fill="#7f987e"/><path d="m0 854 189-170 184 84 132-93 237 170 180-143 158 149v263H0" fill="#536e57"/>
  <path d="M0 882q270 67 540-4t540-1v563H0" fill="url(#water)"/><path d="M0 929q255-69 540-16t540-10M40 981q320-38 600-4m-240 62q260-23 563-24M75 1121q190-30 423-1m130 83q170-25 383-7" fill="none" stroke="#ccdbc7" stroke-width="3" opacity=".4"/>
  <path d="M0 1440V1199q165-93 285-93t297 183q65 80 213 151" fill="#c5bb99"/><path d="M0 1440v-88q165-69 304-31t310 119" fill="#a49f7e"/>
  <path d="M800 1440q-11-233 149-424t131-348" fill="none" stroke="#354c31" stroke-width="20"/><path d="M900 1192q-146-14-161-143 122-4 161 143m43-97q-47-171 76-219 41 142-76 219m44-151q-91-83-79-194 110 18 79 194m39-163q-8-156 95-199 32 143-95 199M853 1321q-137-36-163-138 130-37 163 138" fill="url(#leaf)"/>
  <path d="M0 145q86 80 157 182" stroke="#485c36" fill="none" stroke-width="12"/><path d="M53 194q103-8 108 93-74 12-108-93M94 250Q-8 238 1 328q97-8 93-78M151 324q95-16 114 70-94 35-114-70" fill="#64774b"/>
  <path d="m315 1095 104-46 130 52-91 43z" fill="#d3d1ad"/><path d="m315 1095 143 49v18l-143-46z" fill="#a5a282"/><path d="m458 1144 91-43v19l-91 42z" fill="#7b866a"/>
  <text x="90" y="1270" fill="#f5f0da" font-size="15" font-family="sans-serif" letter-spacing="5">A MOMENT TO KEEP</text><text x="86" y="1340" fill="#f4efd9" font-size="48" font-family="serif">Somewhere, slowly.</text>
  </g></svg>`], '山间一刻_示例插画.svg', { type:'image/svg+xml' });
}

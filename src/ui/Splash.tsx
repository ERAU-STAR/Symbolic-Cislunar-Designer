// Start screen: logo, STAR Group mark, NSF acknowledgement and author credit (no copyright claim until the
// ownership is settled with the PI / ERAU). Click the logo (or Start) to begin.
import { useState } from 'react';
import { FUNDING } from '../brand';
const asset = (f: string) => new URL(`brand/${f}`, document.baseURI).toString();

export function Splash({ onStart }: { onStart: () => void }) {
  const [nsfLogo, setNsfLogo] = useState(true); // hidden when public/brand/nsf.png is not there
  return (
    <div className="splash" onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onStart(); }}>
      <img className="splash-star" src={asset('star.jpg')} alt="STAR Group" />
      <button className="splash-logo" onClick={onStart} aria-label="Start Symbolic Cislunar Designer">
        <img src={asset('logo.png')} alt="Symbolic Cislunar Designer" />
      </button>
      <div className="splash-sub">Symbolic dynamics for cislunar trajectory design: build a word of regions, map the section, pick a trajectory, design the maneuvers, and compare with flown missions.</div>
      <button className="primary splash-go" onClick={onStart}>Start →</button>
      <div className="splash-foot">
        <div className="splash-nsf">
          {nsfLogo && <img src={asset('nsf.png')} alt="National Science Foundation" onError={() => setNsfLogo(false)} />}
          <span>{FUNDING}</span>
        </div>
        <div>Developed by <b>Seur Gi Jo</b> · STAR Group, Embry-Riddle Aeronautical University</div>
      </div>
    </div>
  );
}

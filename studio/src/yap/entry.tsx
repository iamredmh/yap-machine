import { Composition, registerRoot } from 'remotion';
import '../engine/fonts';
import { Visuals, type VisualPlan } from './Visuals';
const defaults: VisualPlan = { pack: 'volt', original: false, motion: 'balanced', width: 1080, height: 1920, fps: 30, duration: 3, plate: '', words: [], effects: [], thirds: [], shoot: { width: 1080, height: 1920, faceX: 540, crown: 380, eyes: 600, chin: 1000 } };
registerRoot(() => <Composition id="YapVisuals" component={Visuals} width={1080} height={1920} fps={30} durationInFrames={90} defaultProps={defaults} calculateMetadata={({ props }) => ({ width: props.width, height: props.height, fps: props.fps, durationInFrames: Math.max(1, Math.round(props.duration * props.fps)) })}/>);

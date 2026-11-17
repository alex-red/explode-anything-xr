// E1 + T3 (docs/VIDEO_PRODUCTION.md §4.1): the headset lesson from the start, by hand, then the turn to the codebase.
import { moves } from './lib.mjs';
const CUT = 'edge:transmits:part:cameras->part:board';
export default {
  forget: true,
  beats: [
    ['open', async (a) => {
      const m = moves(a);
      await a.sleep(2200); // the closed headset on the desk
      await a.pull();
      await m.stepIs(/headset-tutorial:1:/, 'exploded', 5000);
      await a.sleep(1300);
      await m.btn('trace', 1600);
      await m.plug(CUT, 1300);
      await m.node('part:board', 0); // predict: the board loses its input first
      await a.sleep(4200); // the room goes dark; app sound only
    }],
    ['repair', async (a) => {
      const m = moves(a);
      await a.sleep(600);
      await m.btn('next', 900);
      await m.node('part:display', 1100); // wrong socket
      await m.node('part:board', 2800); // right socket: the room comes back
    }],
    ['turn', async (a) => {
      const m = moves(a);
      await a.sleep(500);
      await m.btn('explode', 2200); // collapse: the headset closes up
      await m.btn('next', 0); // Continue: software
      await m.stepIs(/auth-service/, 'codebase', 15000);
      await a.sleep(3500);
    }],
  ],
};

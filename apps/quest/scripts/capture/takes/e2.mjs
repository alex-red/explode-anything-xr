// E2: the stage on the desk; leave the session and come back, and it is on the same spot.
export default {
  forget: true, // the headset model, placed afresh on the desk
  beats: [
    ['desk', async (a) => {
      await a.sleep(1500);
      await a.look([a.HEAD.x, 0.79, 0.5], 1.4); // down to the desk
      await a.sleep(1200);
      await a.look(null, 1.2); // back to the model
      await a.sleep(1500);
    }],
    ['return', async (a) => {
      await a.xr('exit', {});
      await a.sleep(2500);
      await a.xr('enter', {});
      await a.sleep(2500);
      await a.xr('set-input-mode', { mode: 'hand' });
      await a.xr('set-transform', { device: 'headset', position: a.HEAD, orientation: { pitch: -20, yaw: 0, roll: 0 } });
      for (const [device, position] of Object.entries(a.HANDS)) await a.xr('set-transform', { device, position, orientation: { pitch: -10, yaw: 0, roll: 0 } });
      await a.sleep(3500);
      const t = await a.targets();
      console.info('[capture] after return: ' + t.placedOn);
    }],
  ],
};

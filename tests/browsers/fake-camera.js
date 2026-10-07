// Injected before any page script: navigator.mediaDevices becomes a plain object whose
// camera is a canvas. Page code can then never reach the browser's native capture
// machinery: in WebKit, even a 'devicechange' listener on the native object asks macOS
// for the camera.
(() => {
  const fakeStream = (constraints = {}) => {
    const video = constraints.video
    const w = (video && video.width && (video.width.ideal || video.width)) || 640
    const h = (video && video.height && (video.height.ideal || video.height)) || 480
    const canvas = document.createElement('canvas'); canvas.width = Number(w) || 640; canvas.height = Number(h) || 480
    const ctx = canvas.getContext('2d'); let frame = 0
    const draw = () => { ctx.fillStyle = `hsl(${(frame++ * 3) % 360} 70% 50%)`; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#fff'; ctx.fillRect((frame * 4) % canvas.width, canvas.height / 2 - 20, 40, 40) }
    draw(); const timer = setInterval(draw, 33)
    const stream = canvas.captureStream(30)
    for (const t of stream.getTracks()) { const stop = t.stop.bind(t); t.stop = () => { clearInterval(timer); stop() } }
    return stream
  }
  const devices = [
    { deviceId: 'fake-camera', groupId: 'fake', kind: 'videoinput', label: 'Fake camera' },
    { deviceId: 'fake-microphone', groupId: 'fake', kind: 'audioinput', label: 'Fake microphone' },
  ].map(d => ({ ...d, toJSON() { return { deviceId: d.deviceId, groupId: d.groupId, kind: d.kind, label: d.label } } }))
  const fake = new EventTarget()
  Object.assign(fake, {
    ondevicechange: null,
    getUserMedia: async constraints => {
      if (constraints && constraints.audio && !constraints.video) throw new DOMException('No fake microphone', 'NotFoundError')
      return fakeStream(constraints)
    },
    enumerateDevices: async () => devices,
    getSupportedConstraints: () => ({ width: true, height: true, deviceId: true, facingMode: true, frameRate: true }),
    getDisplayMedia: async () => fakeStream({ video: true }),
  })
  Object.defineProperty(Navigator.prototype, 'mediaDevices', { configurable: true, get: () => fake })
  for (const name of ['getUserMedia', 'webkitGetUserMedia', 'mozGetUserMedia']) {
    try { Object.defineProperty(Navigator.prototype, name, { configurable: true, value: (c, ok, fail) => fakeStream(c) && ok ? ok(fakeStream(c)) : undefined }) } catch {}
  }
})()

// Injected before any page script: a camera that is a canvas, so no test ever opens a real device.
(() => {
  const devices = navigator.mediaDevices || (navigator.mediaDevices = {})
  const fakeStream = (constraints = {}) => {
    const video = constraints.video
    const w = (video && video.width && (video.width.ideal || video.width)) || 640
    const h = (video && video.height && (video.height.ideal || video.height)) || 480
    const canvas = document.createElement('canvas'); canvas.width = Number(w) || 640; canvas.height = Number(h) || 480
    const ctx = canvas.getContext('2d'); let frame = 0
    const draw = () => { ctx.fillStyle = `hsl(${(frame++ * 3) % 360} 70% 50%)`; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#fff'; ctx.fillRect((frame * 4) % canvas.width, canvas.height / 2 - 20, 40, 40) }
    draw(); const timer = setInterval(draw, 33)
    const stream = canvas.captureStream(30)
    if (constraints.audio) {
      try { const ac = new AudioContext(); const dest = ac.createMediaStreamDestination(); const osc = ac.createOscillator(); osc.connect(dest); osc.start(); for (const t of dest.stream.getAudioTracks()) stream.addTrack(t) } catch {}
    }
    for (const t of stream.getTracks()) { const stop = t.stop.bind(t); t.stop = () => { clearInterval(timer); stop() } }
    return stream
  }
  devices.getUserMedia = async constraints => fakeStream(constraints)
  devices.enumerateDevices = async () => [
    { deviceId: 'fake-camera', groupId: 'fake', kind: 'videoinput', label: 'Fake camera', toJSON() { return this } },
    { deviceId: 'fake-microphone', groupId: 'fake', kind: 'audioinput', label: 'Fake microphone', toJSON() { return this } },
  ]
  if (navigator.getUserMedia) navigator.getUserMedia = (c, ok, fail) => fakeStream(c) && ok(fakeStream(c))
})()

# AviSynth
video = AVISource("clip.avi")
audio = WAVSource("track.wav")
AudioDub(video, audio).Trim(0, 300)

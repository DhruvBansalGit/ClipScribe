"""Optional macOS test fixture preparation; never called by the application.

Requires the real JFK fixture from README, FFmpeg, and macOS say/Lekha.
Hindi speech here is explicitly synthesized; no transcript is injected into ASR.
A separate human-Hindi FLEURS sample can be used for the stricter known-quality
failure test; see TESTING.md. No media is committed.
"""
from pathlib import Path
import shutil
import struct
import subprocess

root=Path('.local');root.mkdir(exist_ok=True)
assert (root/'jfk.wav').exists(), 'Prepare the README JFK fixture first.'
def run(*args):subprocess.run(args,check=True)
run('say','-v','Lekha','-o',str(root/'hindi.aiff'),'नमस्ते दोस्तों। आज हम अपने शहर के मौसम के बारे में बात करेंगे। सुबह से बारिश हो रही है और हवा बहुत ठंडी है। मुझे हिंदी में बात करना पसंद है।')
run('ffmpeg','-v','error','-i',str(root/'hindi.aiff'),'-ar','16000','-ac','1','-y',str(root/'hindi.wav'))
run('ffmpeg','-v','error','-i',str(root/'jfk.wav'),'-i',str(root/'hindi.wav'),'-filter_complex','[0:a]apad=pad_dur=0.8[a];[1:a]apad=pad_dur=0.8[b];[a][b]concat=n=2:v=0:a=1[out]','-map','[out]','-ar','16000','-ac','1','-y',str(root/'mixed.wav'))
run('ffmpeg','-v','error','-f','lavfi','-i','color=c=0x19231b:s=640x360:r=24','-i',str(root/'mixed.wav'),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-shortest','-y',str(root/'mixed.mp4'))
run('ffmpeg','-v','error','-f','lavfi','-i','color=c=0x19231b:s=160x90:r=1:d=620','-i',str(root/'jfk.wav'),'-filter_complex','[1:a]asplit=2[a][b];[b]adelay=605000|605000[late];[a][late]amix=inputs=2:normalize=0,apad=whole_dur=620[out]','-map','0:v','-map','[out]','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-t','620','-y',str(root/'long-source.mp4'))
shutil.copyfile(root/'long-source.mp4',root/'long-large.mp4')
padding=110*1024*1024
with (root/'long-large.mp4').open('r+b') as file:
    file.seek(0,2);file.write(struct.pack('>I4s',padding,b'free'));file.seek(padding-9,1);file.write(b'\0')
print('Prepared mixed-language fixture and 620-second large-file test:',(root/'long-large.mp4').stat().st_size,'bytes')

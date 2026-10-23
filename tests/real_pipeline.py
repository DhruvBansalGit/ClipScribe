"""Run against the local server and an installed Base model.

python tests/real_pipeline.py .local/real-speech.mp4
Uses actual FFmpeg and Whisper; never substitutes recognized text.
Pass the JFK test clip described in README for the keyword assertion.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import uuid
import wave

import httpx
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend import worker

video = Path(sys.argv[1]).resolve()
cache = Path(os.environ.get('CLIPSCRIBE_MODEL_DIR', Path.home()/'.cache/clipscribe/models'))
weights = cache/'base/model.bin'
before = weights.stat().st_mtime_ns
checks = []


def record(name):
    checks.append(name)
    print('PASS:', name, flush=True)


with httpx.Client(base_url='http://127.0.0.1:8001', timeout=30) as client:
    config = client.get('/api/config').json()
    headers = {'X-ClipScribe-Token': config['token'], 'X-Filename': 'real-speech.mp4'}

    def upload(path, query='model=base&language=auto&cleanup=immediate'):
        headers['X-Request-ID'] = uuid.uuid4().hex
        with path.open('rb') as source:
            response = client.post('/api/jobs?'+query, headers=headers, content=source)
        response.raise_for_status()
        return response.json()['id']

    def finished(job_id):
        for _ in range(300):
            job = client.get('/api/jobs/'+job_id).json()
            if job['status'] in ('completed','cancelled','failed') and (job.get('media_deleted') or job.get('cleanup')=='15min'):
                return job
            time.sleep(.2)
        raise AssertionError('Worker timed out')

    job = finished(upload(video))
    assert job['status']=='completed', job
    assert 'country' in job['result']['text'].lower()
    assert job['result']['language']=='en'
    assert all(0<=s['start']<s['end']<=job['duration'] for s in job['result']['segments'])
    assert job['media_deleted']
    record('Real human speech, automatic language detection, actual timestamps, immediate cleanup')
    client.delete('/api/jobs/'+job['id'],headers=headers).raise_for_status()

    retained = finished(upload(video,'model=base&language=en&cleanup=15min'))
    assert retained['status']=='completed' and not retained['media_deleted']
    client.delete('/api/jobs/'+retained['id'],headers=headers).raise_for_status()
    assert client.get('/api/jobs/'+retained['id']).status_code==404
    record('Optional retention, explicit discard, and in-memory result removal')

    cancelled_id = upload(video)
    cancel = client.post('/api/jobs/'+cancelled_id+'/cancel', headers=headers)
    cancel.raise_for_status()
    cancelled = finished(cancelled_id)
    assert cancelled['status']=='cancelled' and cancelled['media_deleted']
    record('Real subprocess cancellation and media cleanup')

    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        corrupt = directory/'corrupt.mp4'; corrupt.write_bytes(b'not an actual video')
        failed = finished(upload(corrupt));assert failed['status']=='failed' and failed['media_deleted']
        assert 'corrupted' in failed['error']
        record('Corrupt media failure and cleanup')
        silence = directory/'silence.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=s=160x90:d=3','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-shortest','-y',str(silence)], check=True)
        failed = finished(upload(silence));assert failed['status']=='failed' and 'No intelligible speech' in failed['error'] and failed['media_deleted']
        record('Real silent audio produces no fabricated transcript')
        long_video = directory/'long-speech.mp4'
        subprocess.run(['ffmpeg','-v','error','-stream_loop','16','-i',str(video),'-c','copy','-y',str(long_video)],check=True)
        long_id = upload(long_video)
        for _ in range(150):
            current = client.get('/api/jobs/'+long_id).json()
            if current['stage']=='Transcribing audio':
                break
            time.sleep(.2)
        assert current['stage']=='Transcribing audio', current
        start = time.monotonic()
        assert client.get('/api/config').status_code==200
        assert time.monotonic()-start<2
        client.post('/api/jobs/'+long_id+'/cancel',headers=headers).raise_for_status()
        stopped=finished(long_id)
        assert stopped['status']=='cancelled' and stopped['media_deleted']
        record('Three-minute actual video reaches inference; API remains responsive; active inference cancellation works')
        delayed = directory/'delayed.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=s=160x90:d=4','-itsoffset','2','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=2','-c:v','libx264','-c:a','aac','-t','4','-y',str(delayed)],check=True)
        audio=directory/'audio.wav';worker.extract(delayed,audio,60)
        with wave.open(str(audio),'rb') as wav:
            assert wav.getframerate()==16000 and wav.getnchannels()==1
            samples=np.frombuffer(wav.readframes(wav.getnframes()),dtype=np.int16)
        assert np.abs(samples[:24000]).mean()<2 and np.abs(samples[36000:44000]).mean()>500
        record('16 kHz mono extraction preserves delayed audio on source video timeline')

# Independently exercise the genuine worker with all Python socket connections
# prohibited. FFmpeg is separately restricted to local file/pipe demuxers.
os.environ['HF_HUB_OFFLINE']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
network_attempts=[]
original_connect=socket.socket.connect
original_connect_ex=socket.socket.connect_ex

def deny(self,address):
    network_attempts.append(str(address))
    raise AssertionError('Network attempted during cached local inference')

socket.socket.connect=deny
socket.socket.connect_ex=deny
try:
    import shutil
    with tempfile.TemporaryDirectory() as directory:
        media=Path(directory)/'media.mp4';shutil.copyfile(video,media)
        events=[];worker.emit=lambda **data:events.append(data)
        worker.run_job({'media':str(media),'model_path':str(cache/'base'),'model':'base','device':'cpu','threads':4,'language':'en','max_duration':7200})
        assert 'country' in events[-1]['result']['text'].lower()
        assert not network_attempts
finally:
    socket.socket.connect=original_connect
    socket.socket.connect_ex=original_connect_ex
assert weights.stat().st_mtime_ns==before
record('Actual cached-model inference with Python socket access blocked; no weight redownload')
print(json.dumps({'passed':len(checks),'checks':checks},indent=2))

"""Fast API policy/unit tests use injected failures, not fake recognition.
Actual media/recognition is covered separately by real_pipeline.py and browser tests.
"""
import json
from pathlib import Path
import subprocess
import sys
import pytest
from fastapi.testclient import TestClient
from backend import app as api
from backend import worker


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(api, 'TEMP_ROOT', tmp_path)
    monkeypatch.setattr(api, 'JOBS', {})
    monkeypatch.setattr(api, 'INSTALLS', {})
    monkeypatch.setattr(api, 'installed', lambda model: True)
    monkeypatch.setattr(api.POOL, 'submit', lambda *args: None)
    return TestClient(api.app)


def headers(**extra):
    return {'X-ClipScribe-Token': api.TOKEN, 'X-Filename': 'video.mp4', 'X-Request-ID': 'test-request-123', **extra}


def test_config_without_cloud_credentials(client):
    response = client.get('/api/config')
    assert response.status_code == 200
    assert 'base' in response.json()['models']
    assert len(response.json()['languages']) == 100


@pytest.mark.parametrize('origin', ['https://evil.example', 'null', 'http://127.0.0.1:9999'])
def test_reject_cross_origin(client, origin):
    assert client.get('/api/config', headers={'Origin': origin}).status_code == 403


def test_token_and_host_boundary(client):
    assert client.post('/api/jobs').status_code == 403
    assert client.get('/api/config', headers={'Host': 'evil.example'}).status_code == 400


def test_settings_and_formats(client):
    assert client.post('/api/jobs?model=large', headers=headers()).status_code == 400
    assert client.post('/api/jobs?language=not-a-language', headers=headers()).status_code == 400
    assert client.post('/api/jobs', headers=headers(**{'X-Filename':'bad.html'})).status_code == 415


def test_missing_dependencies_message(client, monkeypatch):
    monkeypatch.setattr(api.shutil,'which',lambda _: None)
    response=client.post('/api/jobs',headers=headers())
    assert response.status_code==503 and 'Install FFmpeg' in response.text


def test_missing_python_speech_dependencies(client, monkeypatch):
    monkeypatch.setattr(api,'speech_ready',lambda:False)
    assert client.get('/api/config').json()['speech_dependencies'] is False
    response=client.post('/api/jobs',headers=headers())
    assert response.status_code==503 and 'Python speech dependencies' in response.text
    assert client.post('/api/models/tiny/install',headers=headers()).status_code==503


def test_missing_model_no_implicit_download(client, monkeypatch):
    monkeypatch.setattr(api,'installed',lambda _:False)
    response=client.post('/api/jobs',headers=headers())
    assert response.status_code==409 and 'Install this model' in response.text
    assert not api.INSTALLS


def test_limit_by_header_and_stream(client, monkeypatch):
    monkeypatch.setattr(api,'MAX_BYTES',8)
    assert client.post('/api/jobs',headers=headers(),content=b'123456789').status_code==413
    assert client.post('/api/jobs',headers=headers(),content=iter([b'1234',b'56789'])).status_code==413
    assert not api.JOBS
    assert not list(api.TEMP_ROOT.iterdir())


def test_empty_file_removed(client):
    assert client.post('/api/jobs',headers=headers(),content=b'').status_code==400
    assert not list(api.TEMP_ROOT.iterdir())


def test_safe_filename_duplicate_and_cancellation(client):
    h=headers(**{'X-Filename':'../../private/my-video.mp4'})
    response=client.post('/api/jobs',headers=h,content=b'video')
    assert response.status_code==202
    job=response.json()
    assert job['filename']=='my-video.mp4'
    assert 'directory' not in job and 'config' not in job
    assert client.post('/api/jobs',headers=h,content=b'video').json()['id']==job['id']
    assert len(api.JOBS)==1
    assert client.delete('/api/jobs/'+job['id'],headers=h).status_code==409
    cancel=client.post('/api/jobs/'+job['id']+'/cancel',headers=h).json()
    assert cancel['status']=='cancelled' and cancel['media_deleted']
    assert client.delete('/api/jobs/'+job['id'],headers=h).status_code==200


def test_queue_bound(client):
    for i in range(3):
        assert client.post('/api/jobs',headers=headers(**{'X-Request-ID':f'request-{i}'}),content=b'x').status_code==202
    assert client.post('/api/jobs',headers=headers(**{'X-Request-ID':'overflow-123'}),content=b'x').status_code==429


def test_model_download_failure_is_actionable(monkeypatch,tmp_path):
    class FailedProcess:
        def wait(self,**kwargs):return 1
    monkeypatch.setattr(api,'CACHE',tmp_path)
    monkeypatch.setattr(api.subprocess,'Popen',lambda *args,**kwargs:FailedProcess())
    monkeypatch.setattr(api,'INSTALLS',{})
    api.install_work('tiny')
    assert api.INSTALLS['tiny']['status']=='failed'
    assert 'internet connection' in api.INSTALLS['tiny']['error']


def test_probe_rejects_corrupt_file(tmp_path):
    file=tmp_path/'corrupt.mp4';file.write_bytes(b'bad video')
    with pytest.raises(ValueError,match='corrupted or unreadable'):worker.probe(file,60)


def test_probe_rejects_local_or_remote_playlist(tmp_path):
    file=tmp_path/'malicious.mp4';file.write_text('#EXTM3U\nhttp://127.0.0.1:9/private.ts\n')
    with pytest.raises(ValueError,match='corrupted or unreadable'):worker.probe(file,60)


def test_probe_no_audio_and_duration_limit(tmp_path):
    silent=tmp_path/'mute.mp4'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=s=64x64:d=1','-y',str(silent)],check=True)
    with pytest.raises(ValueError,match='no audio'):worker.probe(silent,60)
    audible=tmp_path/'audio.mp4'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=s=64x64:d=2','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-shortest','-y',str(audible)],check=True)
    with pytest.raises(ValueError,match='duration'):worker.probe(audible,1)


def test_missing_ffprobe(monkeypatch):
    def missing(*a,**kw):raise FileNotFoundError()
    monkeypatch.setattr(worker.subprocess,'run',missing)
    with pytest.raises(ValueError,match='FFprobe is missing'):worker.probe('video',60)
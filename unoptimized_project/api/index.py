import sys
import json
import os
import time
from http.server import BaseHTTPRequestHandler

# In a Serverless environment, this global dictionary PERSISTS across warm invocations
# but resets when Vercel destroys the container. Still perfectly demonstrates leak.
cache = {}

def get_actual_size(o):
    return sys.getsizeof(o)

def get_cache_size():
    return sum(sys.getsizeof(k) + get_actual_size(v) for k, v in cache.items()) + sys.getsizeof(cache)

def generate_payload(ptype):
    if ptype == "data":
        return json.dumps({"status": "ok", "items": [i for i in range(100000)]}).encode('utf-8')
    elif ptype == "dms":
        return ("This is a simulated Direct Message. user123 says hello! " * 50000).encode('utf-8')
    elif ptype == "voice":
        return os.urandom(5 * 1024 * 1024)
    elif ptype == "image":
        return os.urandom(10 * 1024 * 1024)
    elif ptype == "video":
        return os.urandom(25 * 1024 * 1024)
    return b"Unknown payload type"

class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type")
        self.end_headers()

    def do_GET(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        
        # Vercel gives you path such as /api/unoptimized/data
        # We need to extract the exact endpoint (data, voice, etc)
        path = self.path.split('/')[-1]
        
        if path == "ping" or path == "unoptimized": # root of the endpoint
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(b"pong")
            return
            
        if path == "stats":
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            stats = {"cache_bytes": get_cache_size()}
            self.wfile.write(json.dumps(stats).encode('utf-8'))
            return

        supported_types = ["data", "dms", "voice", "image", "video"]
        if path in supported_types:
            self.send_header('Content-type', 'application/octet-stream')
            self.end_headers()
            
            cache_key = f"{path}_{time.time()}"
            
            payload = generate_payload(path)
            cache[cache_key] = payload
            
            self.wfile.write(payload)
            return

        self.send_error(404)

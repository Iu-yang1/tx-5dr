"""Windows virtual COM peer -> TX-5DR WinKeyer TCP bridge.
Install pyserial; create a virtual COM pair separately. N1MM opens one end,
this process opens the other. No physical radio keying is performed here."""
import argparse
import socket
import threading
import serial

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--com",required=True)
    p.add_argument("--host",required=True)
    p.add_argument("--port",type=int,default=4534)
    a=p.parse_args()
    with serial.Serial(a.com,1200,bytesize=8,parity="N",stopbits=2,timeout=0.1,write_timeout=2) as port:
        with socket.create_connection((a.host,a.port),timeout=3) as sock:
            sock.settimeout(0.2)
            done=threading.Event()
            def receive():
                try:
                    while not done.is_set():
                        try:
                            data=sock.recv(4096)
                        except socket.timeout:
                            continue
                        if not data: break
                        port.write(data)
                finally:
                    done.set()
            thread=threading.Thread(target=receive,daemon=True)
            thread.start()
            try:
                while not done.is_set():
                    data=port.read(port.in_waiting or 1)
                    if data: sock.sendall(data)
            finally:
                done.set()
                try: sock.shutdown(socket.SHUT_RDWR)
                except OSError: pass
                thread.join(2)

if __name__=="__main__":
    main()

"""Connect a Windows virtual COM peer to a TX-5DR TCP CAT or WinKeyer bridge."""
import argparse
import socket
import threading


def socket_to_serial(sock, port, done):
    try:
        while not done.is_set():
            try:
                data = sock.recv(4096)
            except socket.timeout:
                continue
            if not data:
                break
            port.write(data)
    except OSError as exc:
        print("N1MM TCP receive failed:", exc, flush=True)
    finally:
        done.set()


def relay(port, sock):
    sock.settimeout(0.2)
    done = threading.Event()
    thread = threading.Thread(target=socket_to_serial, args=(sock, port, done), daemon=True)
    thread.start()
    try:
        while not done.is_set():
            data = port.read(port.in_waiting or 1)
            if data:
                sock.sendall(data)
    finally:
        done.set()
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError as exc:
            print("N1MM TCP shutdown:", exc, flush=True)
        thread.join(2)


def main():
    import serial

    parser = argparse.ArgumentParser()
    parser.add_argument("--com", required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, default=4534)
    parser.add_argument("--baud", type=int, default=1200)
    parser.add_argument("--stopbits", type=int, choices=(1, 2), default=2)
    args = parser.parse_args()
    with serial.Serial(
        args.com, args.baud, bytesize=8, parity="N", stopbits=args.stopbits,
        timeout=0.1, write_timeout=2,
    ) as port:
        with socket.create_connection((args.host, args.port), timeout=3) as sock:
            relay(port, sock)


if __name__ == "__main__":
    main()

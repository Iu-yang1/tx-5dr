"""Connect a Windows virtual COM peer to a TX-5DR TCP CAT or WinKeyer bridge."""
import argparse
import errno
import queue
import socket
import threading


def socket_to_serial(sock, port, done, failures):
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
        failures.put(exc)
    finally:
        done.set()


def relay(port, sock):
    sock.settimeout(0.2)
    done = threading.Event()
    failures = queue.SimpleQueue()
    thread = threading.Thread(
        target=socket_to_serial, args=(sock, port, done, failures), daemon=True
    )
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
            if exc.errno not in (errno.ENOTCONN, errno.EBADF):
                failures.put(exc)
        thread.join(2)
    if thread.is_alive():
        raise TimeoutError("N1MM TCP receiver did not terminate")
    if not failures.empty():
        raise ConnectionError("N1MM TCP/serial relay failed") from failures.get()


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

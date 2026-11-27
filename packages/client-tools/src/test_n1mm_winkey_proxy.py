import importlib.util
import pathlib
import queue
import socket
import threading
import unittest

SPEC = importlib.util.spec_from_file_location(
    "n1mm_winkey_proxy", pathlib.Path(__file__).with_name("n1mm-winkey-proxy.py")
)
PROXY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROXY)


class SimulatedSerial:
    def __init__(self):
        self.outbound = queue.Queue()
        self.inbound = queue.Queue()

    @property
    def in_waiting(self):
        return 0

    def read(self, size):
        try:
            return self.outbound.get(timeout=0.05)
        except queue.Empty:
            return b""

    def write(self, data):
        self.inbound.put(data)


class WinKeyProxyTests(unittest.TestCase):
    def test_serial_tcp_roundtrip_and_eof(self):
        port = SimulatedSerial()
        errors = queue.SimpleQueue()
        with self.connected_pair() as (local, peer):
            def worker():
                try:
                    PROXY.relay(port, local)
                except Exception as exc:
                    errors.put(exc)

            thread = threading.Thread(target=worker, daemon=True)
            thread.start()
            try:
                port.outbound.put(b"\x00\x02")
                self.assertEqual(peer.recv(2), b"\x00\x02")
                peer.sendall(b"\x17")
                self.assertEqual(port.inbound.get(timeout=2), b"\x17")
                peer.shutdown(socket.SHUT_WR)
            finally:
                peer.close()
                thread.join(3)
            self.assertFalse(thread.is_alive())
            self.assertTrue(errors.empty())

    def test_receiver_propagates_serial_write_failure(self):
        port = SimulatedSerial()

        def failing_write(data):
            raise OSError("simulated COM failure")

        port.write = failing_write
        with self.connected_pair() as (local, peer):
            peer.sendall(b"CQ")
            with self.assertRaises(ConnectionError):
                PROXY.relay(port, local)

    @staticmethod
    def connected_pair():
        from contextlib import contextmanager

        @contextmanager
        def pair():
            left, right = socket.socketpair()
            try:
                right.settimeout(2)
                yield left, right
            finally:
                left.close()
                right.close()

        return pair()


if __name__ == "__main__":
    unittest.main()

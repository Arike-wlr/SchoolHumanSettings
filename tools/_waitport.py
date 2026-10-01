# -*- coding: utf-8 -*-
"""探测本机端口是否已被监听（给 .bat 调用，成功退出码 0，失败 1）。

写成独立文件而不是 python -c 一行，是因为 bat 里内联引号/括号极易出错。
"""
import socket
import sys

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
s = socket.socket()
s.settimeout(0.4)
sys.exit(0 if s.connect_ex(('127.0.0.1', port)) == 0 else 1)

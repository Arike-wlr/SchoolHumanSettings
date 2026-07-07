package main

import (
	"embed"
	"fmt"
	"net/http"
	"os/exec"
	"runtime"
)

//go:embed *.html *.js
var staticFiles embed.FS

var routeMap = map[string]string{
	"/":          "index.html",
	"/index":     "index.html",
	"/worldview": "worldview.html",
	"/relations": "relations.html",
	"/documents": "documents.html",
}

func main() {
	port := ":8080"

	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// 路由映射
		if file, ok := routeMap[r.URL.Path]; ok {
			data, err := staticFiles.ReadFile(file)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(data)
			return
		}
		// 静态资源（JS 文件等）
		data, err := staticFiles.ReadFile(r.URL.Path[1:]) // 去掉开头的 /
		if err != nil {
			http.NotFound(w, r)
			return
		}
		ct := "application/octet-stream"
		switch {
		case len(r.URL.Path) > 3 && r.URL.Path[len(r.URL.Path)-3:] == ".js":
			ct = "application/javascript"
		case len(r.URL.Path) > 4 && r.URL.Path[len(r.URL.Path)-4:] == ".css":
			ct = "text/css"
		}
		w.Header().Set("Content-Type", ct)
		w.Write(data)
	})

	fmt.Println("校拟设定簿 桌面版 http://localhost" + port)
	openBrowser("http://localhost" + port)
	http.ListenAndServe(port, mux)
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	cmd.Start()
}

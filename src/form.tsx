import { render } from "hono/jsx/dom"
import { useState, useEffect } from "hono/jsx"

const UploadForm = () => {
    const [file, setFile] = useState<File | null>(null)
    const [message, setMessage] = useState<string>('Ready')
    const [status, setStatus] = useState<string>('ready')
    const [downloadUrl, setDownloadUrl] = useState<string>('')
    const [apiKey, setApiKey] = useState<string>('')

    // 追加: name属性を取得する
    useEffect(() => {
        const formDiv = document.getElementById('form')
        if (formDiv && formDiv.hasAttribute('name')) {
            setName(formDiv.getAttribute('name') || '')
        }
    }, [])

    const [name, setName] = useState<string>('')

    const handleSubmit = async (e: Event) => {
        e.preventDefault()
        if (!file) {
            setMessage('No file selected')
            setStatus('error')
            return
        }

        const formData = new FormData()
        formData.append('file', file)
        // name属性があれば追加
        if (name) {
            formData.append('name', name)
        }
        
        const headers: Record<string, string> = {}
        if (apiKey) {
            headers['x-api-key'] = apiKey
        }
        
        setMessage('Uploading...')
        setStatus('uploading')

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                headers,
                body: formData,
            })
            const result = await response.json() as {
                message?: string,
                fileName?: string,
                error?: string,
                results?: string[]
            }
            if (response.ok) {
                const url = `${window.location.origin}/files/${result.fileName}`
                let displayMessage = `File uploaded successfully: ${result.fileName}`
                if (result.results && result.results.length > 1) {
                    displayMessage = result.results.join('\n')
                }
                setMessage(displayMessage)
                setDownloadUrl(url)
                setStatus('success')
            } else {
                setMessage(`Error: ${result.error!}`)
                setStatus('error')
            }
        } catch (error) {
            setMessage(`Upload failed: ${error}`)
            setStatus('error')
        }
    }

    return (
        <>
            <form onSubmit={handleSubmit}>
                <div class="form-group">
                    <label for="api-key">API Key (if required):</label>
                    <input 
                        id="api-key" 
                        type="password" 
                        value={apiKey}
                        onChange={(e) => setApiKey((e.target as HTMLInputElement).value)}
                        placeholder="Enter API key (optional)"
                    />
                </div>
                
                <div class="form-group">
                    <label for="file-upload" class="file-label">
                        {file ? file.name : 'Select a file'}
                    </label>
                    <input 
                        id="file-upload" 
                        type="file" 
                        onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] || null)} 
                    />
                </div>
                
                <button type="submit" disabled={!file}>Upload</button>
            </form>
            <input type="text" id="downloadUrl" placeholder="Download URL" value={downloadUrl} readonly />
            <div class="status-bar">
                <span className={`status-indicator ${status}`}></span>
                <span class="status-text">{message}</span>
            </div>
        </>
    )
}

render(<UploadForm />, document.getElementById('form')!)
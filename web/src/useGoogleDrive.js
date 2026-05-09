import { useState, useEffect } from 'react'

export function useGoogleDrive({ engine, srcRef, setSrc, fileName, setFileName, setActiveChallenge, setAppDialog }) {
  const [driveFiles, setDriveFiles] = useState(null)
  const [driveToken, setDriveToken] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('sim8085_drive_token'))
      if (saved && saved.token && saved.expiresAt > Date.now()) return saved.token
    } catch {}
    return null
  })
  const [driveLoading, setDriveLoading] = useState(false)
  const [driveSaveStatus, setDriveSaveStatus] = useState(null)

  useEffect(() => {
    if (!driveToken) localStorage.removeItem('sim8085_drive_token')
  }, [driveToken])

  function handleDriveDisconnect() {
    if (window.google) window.google.accounts.oauth2.revoke(driveToken, () => {})
    setDriveToken(null)
    engine.setMsg('✓ Disconnected from Google Drive')
  }

  function connectDrive(onSuccess) {
    if (!window.google || !window.google.accounts) {
      engine.setMsg('Loading Google Drive script…')
      const s = document.createElement('script')
      s.src = 'https://accounts.google.com/gsi/client'
      s.onload = () => connectDrive(onSuccess)
      s.onerror = () => engine.setMsg('✗ Google script blocked by browser or network firewall.')
      document.head.appendChild(s)
      return
    }
    const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '467288235889-r6gbjd0ou6ubuiktrnaj54bee6iggr01.apps.googleusercontent.com'
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: async (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          const expiresAt = Date.now() + (tokenResponse.expires_in * 1000 || 3500000)
          localStorage.setItem('sim8085_drive_token', JSON.stringify({ token: tokenResponse.access_token, expiresAt }))
          setDriveToken(tokenResponse.access_token)
          if (typeof onSuccess === 'function') onSuccess(tokenResponse.access_token)
          else engine.setMsg('✓ Connected to Google Drive')
        }
      }
    })
    client.requestAccessToken()
  }

  async function saveToDrive() {
    if (!driveToken) { connectDrive(performSave); return }
    performSave(driveToken)
  }

  async function performSave(token, explicitName) {
    engine.setMsg('Saving to Google Drive…')
    setDriveSaveStatus('saving')
    try {
      let folderId = null
      const query = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='sim8085' and trashed=false")
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}`, { headers: { Authorization: 'Bearer ' + token } })
      if (searchRes.status === 401) { setDriveToken(null); engine.setMsg('✗ Drive session expired. Please connect again.'); setDriveSaveStatus(null); return }
      const searchData = await searchRes.json()
      if (searchData.files && searchData.files.length > 0) folderId = searchData.files[0].id
      else {
        const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
          method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'sim8085', mimeType: 'application/vnd.google-apps.folder' })
        })
        folderId = (await createRes.json()).id
      }

      const nameToUse = explicitName || fileName || 'program'
      const name = nameToUse.replace(/\.(asm|85|s|txt)$/i,'') + '.asm'
      
      let existingFileId = null
      if (folderId) {
        const fileQuery = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${folderId}' in parents and trashed=false`)
        const fileSearchData = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${fileQuery}`, { headers: { Authorization: 'Bearer ' + token } })).json()
        if (fileSearchData.files && fileSearchData.files.length > 0) existingFileId = fileSearchData.files[0].id
      }

      const metadata = { name, mimeType: 'text/plain' }
      if (!existingFileId && folderId) metadata.parents = [folderId]

      const form = new FormData()
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
      form.append('file', new Blob([srcRef.current], { type: 'text/plain' }))

      const url = existingFileId ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'
      const res = await fetch(url, { method: existingFileId ? 'PATCH' : 'POST', headers: { Authorization: 'Bearer ' + token }, body: form })
      if (res.status === 401) { setDriveToken(null); engine.setMsg('✗ Drive session expired.'); setDriveSaveStatus(null); return }
      if (res.ok) {
        engine.setMsg(existingFileId ? '✓ File updated on Google Drive!' : '✓ File saved to "sim8085" folder on Google Drive!')
        if (explicitName) { setFileName(name); localStorage.setItem('sim8085_filename', name) }
        setDriveSaveStatus('success')
        setTimeout(() => setDriveSaveStatus(null), 2000)
      } else { engine.setMsg('✗ Error saving to Google Drive.'); setDriveSaveStatus(null) }
    } catch(e) { engine.setMsg('✗ Network error saving to Google Drive.'); setDriveSaveStatus(null) }
  }

  function saveAsToDrive() {
    setAppDialog({
      type: 'prompt', title: 'Save As (Google Drive)', message: 'Enter new file name:', defaultValue: fileName || 'program.asm', confirmText: 'Save',
      onConfirm: (newName) => {
        if (!newName) return
        const finalName = newName.replace(/\.(asm|85|s|txt)$/i,'') + '.asm'
        if (!driveToken) connectDrive((token) => performSave(token, finalName))
        else performSave(driveToken, finalName)
      }
    })
  }

  async function loadFromDrive() { if (!driveToken) connectDrive(performLoad); else performLoad(driveToken) }
  async function performLoad(token) {
    engine.setMsg('Fetching files from "sim8085" folder on Google Drive…')
    setDriveLoading(true); setDriveFiles([])
    try {
      const query = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and name='sim8085' and trashed=false")
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}`, { headers: { Authorization: 'Bearer ' + token } })
      if (searchRes.status === 401) { setDriveToken(null); engine.setMsg('✗ Drive session expired.'); setDriveFiles(null); setDriveLoading(false); return }
      const searchData = await searchRes.json()
      if (!searchData.files || searchData.files.length === 0) { setDriveFiles([]); setDriveLoading(false); return }
      const filesQuery = encodeURIComponent(`'${searchData.files[0].id}' in parents and trashed=false`)
      const filesData = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${filesQuery}&orderBy=modifiedTime desc`, { headers: { Authorization: 'Bearer ' + token } })).json()
      setDriveFiles(filesData.files || [])
    } catch(e) { engine.setMsg('✗ Network error loading from Google Drive.'); setDriveFiles(null) }
    finally { setDriveLoading(false) }
  }

  async function fetchDriveFile(fileId, fileName) {
    engine.setMsg(`Loading ${fileName}…`); setDriveFiles(null); setActiveChallenge(null)
    try {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&access_token=${encodeURIComponent(driveToken)}`)
      if (res.status === 401) { setDriveToken(null); engine.setMsg('✗ Drive session expired.'); return }
      if (!res.ok) throw new Error('Failed to fetch')
      const text = await res.text()
      srcRef.current = text; setSrc(text); engine.doAssemble(text)
      setFileName(fileName); localStorage.setItem('sim8085_filename', fileName)
      engine.setMsg(`✓ Loaded ${fileName} from Google Drive`)
    } catch(e) { engine.setMsg(`✗ Error loading file: ${e.message}`) }
  }

  async function deleteDriveFile(fileId, fileName) {
    setAppDialog({
      type: 'confirm', title: 'Delete File', message: `Are you sure you want to delete "${fileName}" from your Google Drive?`, confirmText: 'Delete',
      onConfirm: async () => {
        setDriveFiles(files => files ? files.filter(f => f.id !== fileId) : null)
        engine.setMsg(`Deleting ${fileName}…`)
        try {
          const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?access_token=${encodeURIComponent(driveToken)}`, { method: 'DELETE' })
          if (res.status === 401) { setDriveToken(null); engine.setMsg('✗ Drive session expired.'); return }
          if (!res.ok) throw new Error('Failed to delete')
          engine.setMsg(`✓ Deleted ${fileName} from Google Drive`)
        } catch(e) { engine.setMsg(`✗ Error deleting file: ${e.message}`) }
      }
    })
  }

  return {
    driveFiles, setDriveFiles, driveToken, driveLoading, driveSaveStatus,
    connectDrive, handleDriveDisconnect, saveToDrive, saveAsToDrive,
    loadFromDrive, fetchDriveFile, deleteDriveFile
  }
}
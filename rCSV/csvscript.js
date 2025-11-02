class CSVGenerator {
    constructor() {
        this.isAuthenticated = false;
        this.accessToken = null;
        this.tokenClient = null;
        this.isGoogleAPIReady = false;
        this.fileIds = [];
        
        this.initializeElements();
        this.setupEventListeners();
        this.initializeGoogleAPI();
    }

    initializeElements() {
        this.authSection = document.getElementById('authSection');
        this.resultSection = document.getElementById('resultSection');
        this.loadingIndicator = document.getElementById('loadingIndicator');
        this.instructionsSection = document.getElementById('instructionsSection');
        
        this.authButton = document.getElementById('authButton');
        this.csvOutput = document.getElementById('csvOutput');
        this.copyButton = document.getElementById('copyButton');
        this.fileCount = document.getElementById('fileCount');
        this.loadingText = document.getElementById('loadingText');
        
        // Disable auth button initially
        this.authButton.disabled = true;
        this.authButton.querySelector('.auth-btn-text').textContent = 'Loading...';
    }

    setupEventListeners() {
        this.authButton.addEventListener('click', () => this.handleAuthClick());
        this.copyButton.addEventListener('click', () => this.copyToClipboard());
    }

    async initializeGoogleAPI() {
        try {
            console.log('Starting Google API initialization...');
            
            // Wait for both gapi and google to be available
            await Promise.all([
                this.waitForGapi(),
                this.waitForGoogle()
            ]);
            
            console.log('Google libraries loaded');

            // Initialize gapi client
            await new Promise((resolve, reject) => {
                gapi.load('client', {
                    callback: resolve,
                    onerror: reject
                });
            });

            await gapi.client.init({
                apiKey: '', // We'll use OAuth token instead
                discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest']
            });
            
            console.log('GAPI client initialized');

            // Initialize Google Identity Services
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: '652948871244-mcv01l9rj8vfpj74he0obhq0uoa8tejb.apps.googleusercontent.com',
                scope: 'https://www.googleapis.com/auth/drive.readonly',
                callback: (response) => {
                    if (response.error) {
                        console.error('Token error:', response.error);
                        alert(`Authentication failed: ${response.error}`);
                        return;
                    }
                    this.accessToken = response.access_token;
                    gapi.client.setToken({access_token: this.accessToken});
                    this.handleAuthSuccess();
                }
            });
            
            this.isGoogleAPIReady = true;
            console.log('Google API initialized successfully');
            
            // Enable the auth button
            this.authButton.disabled = false;
            this.authButton.querySelector('.auth-btn-text').textContent = 'Generate CSV';
            
        } catch (error) {
            console.error('Failed to initialize Google API:', error);
            alert('Failed to initialize Google API. Please check your setup and try refreshing the page.');
            this.authButton.querySelector('.auth-btn-text').textContent = 'Initialization Failed - Refresh Page';
        }
    }

    waitForGapi() {
        return new Promise((resolve) => {
            const checkGapi = () => {
                if (typeof gapi !== 'undefined') {
                    resolve();
                } else {
                    setTimeout(checkGapi, 100);
                }
            };
            checkGapi();
        });
    }

    waitForGoogle() {
        return new Promise((resolve) => {
            const checkGoogle = () => {
                if (typeof google !== 'undefined' && google.accounts) {
                    resolve();
                } else {
                    setTimeout(checkGoogle, 100);
                }
            };
            checkGoogle();
        });
    }

    handleAuthClick() {
        try {
            console.log('Auth button clicked');
            
            if (!this.isGoogleAPIReady || !this.tokenClient) {
                throw new Error('Google API not initialized. Please wait or refresh the page.');
            }
            
            // Request access token
            this.tokenClient.requestAccessToken({prompt: 'consent'});
        } catch (error) {
            console.error('Authentication failed:', error);
            alert(`Authentication failed: ${error.message}. Please try again.`);
        }
    }

    async handleAuthSuccess() {
        this.isAuthenticated = true;
        
        // Hide auth section and instructions
        this.authSection.style.display = 'none';
        this.instructionsSection.style.display = 'none';
        this.showLoading('Scanning your music folder...');
        
        try {
            await this.scanMusicFolder();
            this.hideLoading();
            this.showResults();
        } catch (error) {
            this.hideLoading();
            console.error('Failed to scan music folder:', error);
            
            // Show user-friendly error message
            const errorMessage = error.message.includes('❌') ? error.message : 
                `❌ Failed to Scan Music Folder\n\n${error.message}\n\nPlease check your setup and try again.`;
            
            alert(errorMessage);
            
            // Show auth section again so user can retry
            this.authSection.style.display = 'block';
            this.instructionsSection.style.display = 'block';
        }
    }

    async scanMusicFolder() {
        try {
            console.log('Scanning for rMusic/Songs folder...');
            
            // Step 1: Find the "rMusic" folder
            const folderResponse = await gapi.client.drive.files.list({
                q: "name='rMusic' and mimeType='application/vnd.google-apps.folder' and trashed=false",
                fields: 'files(id, name)'
            });
            
            if (!folderResponse.result.files || folderResponse.result.files.length === 0) {
                throw new Error('RMUSIC_FOLDER_NOT_FOUND');
            }
            
            const rMusicFolderId = folderResponse.result.files[0].id;
            console.log('Found rMusic folder:', rMusicFolderId);
            
            // Step 2: Find the "Songs" folder inside "rMusic"
            const songsResponse = await gapi.client.drive.files.list({
                q: `name='Songs' and mimeType='application/vnd.google-apps.folder' and parents in '${rMusicFolderId}' and trashed=false`,
                fields: 'files(id, name)'
            });
            
            if (!songsResponse.result.files || songsResponse.result.files.length === 0) {
                throw new Error('SONGS_FOLDER_NOT_FOUND');
            }
            
            const songsFolderId = songsResponse.result.files[0].id;
            console.log('Found Songs folder:', songsFolderId);
            
            // Step 3: Get all audio files from the Songs folder
            this.updateLoadingText('Found folders, scanning audio files...');
            
            let allFiles = [];
            let pageToken = null;
            
            do {
                const filesResponse = await gapi.client.drive.files.list({
                    q: `parents in '${songsFolderId}' and trashed=false and (mimeType contains 'audio' or name contains '.mp3' or name contains '.m4a' or name contains '.wav' or name contains '.flac')`,
                    fields: 'nextPageToken, files(id, name, mimeType)',
                    pageSize: 1000,
                    pageToken: pageToken
                });
                
                if (filesResponse.result.files) {
                    allFiles = allFiles.concat(filesResponse.result.files);
                    this.updateLoadingText(`Found ${allFiles.length} audio files...`);
                }
                
                pageToken = filesResponse.result.nextPageToken;
            } while (pageToken);
            
            if (allFiles.length === 0) {
                throw new Error('NO_AUDIO_FILES');
            }
            
            // Extract file IDs
            this.fileIds = allFiles.map(file => file.id);
            
            console.log(`Found ${this.fileIds.length} audio files`);
            
        } catch (error) {
            console.error('Failed to scan music folder:', error);
            
            // Handle specific errors with user-friendly messages
            if (error.message === 'RMUSIC_FOLDER_NOT_FOUND') {
                throw new Error(`
❌ rMusic Folder Not Found

Please create the required folder structure:

Steps:
1. Go to drive.google.com
2. Click "New" → "Folder"
3. Name it exactly: rMusic
4. Inside rMusic, create another folder named: Songs
5. Upload your music files to the Songs folder
6. Refresh this page and try again
                `);
            } else if (error.message === 'SONGS_FOLDER_NOT_FOUND') {
                throw new Error(`
❌ Songs Folder Not Found

Please create the "Songs" folder inside your "rMusic" folder:

Steps:
1. Go to your "rMusic" folder in Google Drive
2. Click "New" → "Folder"
3. Name it exactly: Songs
4. Upload your music files to this Songs folder
5. Refresh this page and try again
                `);
            } else if (error.message === 'NO_AUDIO_FILES') {
                throw new Error(`
❌ No Audio Files Found

Your "rMusic/Songs" folder is empty or contains no audio files.

Steps:
1. Go to your "rMusic/Songs" folder in Google Drive
2. Upload your MP3, M4A, WAV, or FLAC files
3. Make sure files are not in subfolders
4. Refresh this page and try again

Supported formats: MP3, M4A, WAV, FLAC
                `);
            } else {
                throw new Error(`Failed to scan music folder: ${error.message}`);
            }
        }
    }

    showResults() {
        // Update file count
        this.fileCount.textContent = `Found ${this.fileIds.length} files`;
        
        // Generate CSV content
        const csvContent = this.fileIds.join('\n');
        this.csvOutput.value = csvContent;
        
        // Show result section
        this.resultSection.style.display = 'block';
        
        // Auto-select text for easy copying
        this.csvOutput.focus();
        this.csvOutput.select();
    }

    async copyToClipboard() {
        try {
            await navigator.clipboard.writeText(this.csvOutput.value);
            
            // Update button to show success
            const originalText = this.copyButton.innerHTML;
            this.copyButton.innerHTML = '<i class="fas fa-check"></i><span>Copied!</span>';
            this.copyButton.classList.add('copied');
            
            // Reset button after 2 seconds
            setTimeout(() => {
                this.copyButton.innerHTML = originalText;
                this.copyButton.classList.remove('copied');
            }, 2000);
            
        } catch (error) {
            console.error('Failed to copy to clipboard:', error);
            
            // Fallback: select text for manual copying
            this.csvOutput.focus();
            this.csvOutput.select();
            alert('Please manually copy the selected text (Ctrl+C or Cmd+C)');
        }
    }

    updateLoadingText(text) {
        this.loadingText.textContent = text;
    }

    showLoading(text = 'Loading...') {
        this.updateLoadingText(text);
        this.loadingIndicator.style.display = 'block';
    }

    hideLoading() {
        this.loadingIndicator.style.display = 'none';
    }
}
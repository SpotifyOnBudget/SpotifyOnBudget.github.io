class RDataViewer {
    constructor() {
        this.isAuthenticated = false;
        this.accessToken = null;
        this.tokenClient = null;
        this.isGoogleAPIReady = false;
        this.songsData = [];
        this.concurrentLimit = 8; // Process 8 files simultaneously
        this.blobUrls = new Set(); // Track blob URLs for cleanup
        
        // Virtual scrolling properties
        this.itemHeight = 120; // Height of each song card
        this.containerHeight = 500; // Height of scrollable container
        this.visibleItems = Math.ceil(this.containerHeight / this.itemHeight) + 2; // Buffer items
        this.scrollTop = 0;
        this.startIndex = 0;
        this.endIndex = this.visibleItems;
        
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
        this.songsContainer = document.getElementById('songsContainer');
        this.exportButton = document.getElementById('exportButton');
        this.fileCount = document.getElementById('fileCount');
        this.loadingText = document.getElementById('loadingText');
        
        // Disable auth button initially
        this.authButton.disabled = true;
        this.authButton.querySelector('.auth-btn-text').textContent = 'Loading...';
    }

    setupEventListeners() {
        this.authButton.addEventListener('click', () => this.handleAuthClick());
        this.exportButton.addEventListener('click', () => this.exportData());
        
        // Add scroll listener for virtual scrolling
        this.songsContainer.addEventListener('scroll', () => this.handleScroll());
        
        // Cleanup on page unload
        window.addEventListener('beforeunload', () => this.cleanup());
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
            this.authButton.querySelector('.auth-btn-text').textContent = 'View Song Data';
            
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
                `Failed to Scan Music Folder\n\n${error.message}\n\nPlease check your setup and try again.`;
            
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
            console.log('Step 1: Searching for rMusic folder...');
            const folderResponse = await gapi.client.drive.files.list({
                q: "name='rMusic' and mimeType='application/vnd.google-apps.folder' and trashed=false",
                fields: 'files(id, name)'
            });
            
            if (!folderResponse.result.files || folderResponse.result.files.length === 0) {
                console.error('rMusic folder not found');
                throw new Error('RMUSIC_FOLDER_NOT_FOUND');
            }
            
            const rMusicFolderId = folderResponse.result.files[0].id;
            console.log('✅ Found rMusic folder:', rMusicFolderId);
            
            // Step 2: Find the "Songs" folder inside "rMusic"
            console.log('Step 2: Searching for Songs folder inside rMusic...');
            const songsResponse = await gapi.client.drive.files.list({
                q: `name='Songs' and mimeType='application/vnd.google-apps.folder' and parents in '${rMusicFolderId}' and trashed=false`,
                fields: 'files(id, name)'
            });
            
            if (!songsResponse.result.files || songsResponse.result.files.length === 0) {
                console.error('Songs folder not found inside rMusic');
                throw new Error('SONGS_FOLDER_NOT_FOUND');
            }
            
            const songsFolderId = songsResponse.result.files[0].id;
            console.log('Found Songs folder:', songsFolderId);
            
            // Step 3: Get all audio files from the Songs folder
            console.log('Step 3: Scanning for audio files...');
            this.updateLoadingText('Found folders, scanning audio files...');
            
            let allFiles = [];
            let pageToken = null;
            let pageCount = 0;
            
            do {
                pageCount++;
                console.log(`Fetching page ${pageCount} of audio files...`);
                const filesResponse = await gapi.client.drive.files.list({
                    q: `parents in '${songsFolderId}' and trashed=false and (mimeType contains 'audio' or name contains '.mp3' or name contains '.m4a' or name contains '.wav' or name contains '.flac')`,
                    fields: 'nextPageToken, files(id, name, mimeType)',
                    pageSize: 1000,
                    pageToken: pageToken
                });
                
                if (filesResponse.result.files) {
                    allFiles = allFiles.concat(filesResponse.result.files);
                    console.log(`Page ${pageCount}: Found ${filesResponse.result.files.length} files (Total: ${allFiles.length})`);
                    this.updateLoadingText(`Found ${allFiles.length} audio files...`);
                }
                
                pageToken = filesResponse.result.nextPageToken;
            } while (pageToken);
            
            console.log(`Total audio files found: ${allFiles.length}`);
            
            if (allFiles.length === 0) {
                console.error('No audio files found in Songs folder');
                throw new Error('NO_AUDIO_FILES');
            }
            
            // Step 4: Extract metadata from each file
            console.log('Step 4: Starting metadata extraction...');
            this.updateLoadingText('Extracting metadata from songs...');
            this.songsData = [];
            
            // Process files in batches for better performance
            await this.processSongsProgressively(allFiles);
            
            console.log(`Processing complete! Total songs processed: ${this.songsData.length}`);
            
        } catch (error) {
            console.error('Failed to scan music folder:', error);
            
            // Handle specific errors with user-friendly messages
            if (error.message === 'RMUSIC_FOLDER_NOT_FOUND') {
                throw new Error(`
rMusic Folder Not Found

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
Songs Folder Not Found

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
No Audio Files Found

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

    async processSongsProgressively(allFiles) {
        console.log(`Starting progressive processing of ${allFiles.length} files...`);
        this.isProcessingComplete = false;
        const batchSize = this.concurrentLimit;
        let isFirstBatch = true;
        
        for (let i = 0; i < allFiles.length; i += batchSize) {
            const batch = allFiles.slice(i, i + batchSize);
            const batchNumber = Math.floor(i / batchSize) + 1;
            const totalBatches = Math.ceil(allFiles.length / batchSize);
            
            console.log(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)`);
            this.updateLoadingText(`Processing ${i + 1}-${Math.min(i + batchSize, allFiles.length)}/${allFiles.length} songs...`);
            
            // Process batch concurrently
            console.log(`Starting concurrent processing of batch ${batchNumber}...`);
            const batchPromises = batch.map(file => this.extractFileMetadata(file));
            const batchResults = await Promise.allSettled(batchPromises);
            
            let successCount = 0;
            let failCount = 0;
            
            // Add results to songsData
            batchResults.forEach((result, index) => {
                const file = batch[index];
                if (result.status === 'fulfilled') {
                    this.songsData.push(result.value);
                    successCount++;
                } else {
                    console.warn(`Failed to extract metadata for ${file.name}:`, result.reason);
                    failCount++;
                    // Add file with basic info even if metadata extraction fails
                    this.songsData.push({
                        title: this.extractTitleFromFilename(file.name),
                        artist: 'Unknown Artist',
                        albumArt: null,
                        fileId: file.id,
                        fileName: file.name
                    });
                }
            });
            
            console.log(`Batch ${batchNumber} complete: ${successCount} success, ${failCount} failed`);
            console.log(`Total processed so far: ${this.songsData.length}/${allFiles.length}`);
            
            // Show results after first batch (first ~8 songs)
            if (isFirstBatch) {
                console.log('First batch complete! Showing initial results...');
                this.hideLoading();
                this.showResults();
                isFirstBatch = false;
            } else {
                // Update existing results with new songs
                this.updateResults();
            }
            
            // Small delay to prevent overwhelming the browser
            if (i + batchSize < allFiles.length) {
                console.log(`Brief pause before next batch...`);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        console.log('All batches processed! Final update...');
        this.isProcessingComplete = true;
        this.updateResults();
        console.log(`Processing complete! Total songs: ${this.songsData.length}`);
    }

    async extractFileMetadata(file) {
        return new Promise(async (resolve, reject) => {
            try {
                console.log(`Extracting metadata for: ${file.name}`);
                // Download the file to extract metadata
                const response = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`
                    }
                });
                
                if (!response.ok) {
                    console.error(`HTTP error for ${file.name}: ${response.status} ${response.statusText}`);
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                console.log(`Downloaded ${file.name}, size: ${response.headers.get('content-length')} bytes`);
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                this.blobUrls.add(blobUrl); // Track for cleanup
                
                // Extract metadata using jsmediatags
                console.log(`Reading metadata tags for: ${file.name}`);
                jsmediatags.read(blob, {
                    onSuccess: (tag) => {
                        console.log(`Metadata extracted for ${file.name}:`, {
                            title: tag.tags.title || 'No title',
                            artist: tag.tags.artist || 'No artist',
                            hasAlbumArt: !!tag.tags.picture
                        });
                        const { title, artist, picture } = tag.tags;
                        
                        let albumArt = null;
                        if (picture) {
                            console.log(`Processing album art for: ${file.name}`);
                            const { data, type } = picture;
                            const byteArray = new Uint8Array(data);
                            const albumBlob = new Blob([byteArray], { type });
                            albumArt = URL.createObjectURL(albumBlob);
                            this.blobUrls.add(albumArt); // Track for cleanup
                        } else {
                            console.log(`No album art found for: ${file.name}`);
                        }
                        
                        resolve({
                            title: title || this.extractTitleFromFilename(file.name),
                            artist: artist || 'Unknown Artist',
                            albumArt: albumArt,
                            fileId: file.id,
                            fileName: file.name
                        });
                        
                        // Clean up the blob URL used for metadata extraction
                        URL.revokeObjectURL(blobUrl);
                        this.blobUrls.delete(blobUrl);
                    },
                    onError: (error) => {
                        console.warn(`Metadata extraction failed for ${file.name}:`, error);
                        // Clean up the blob URL
                        URL.revokeObjectURL(blobUrl);
                        this.blobUrls.delete(blobUrl);
                        
                        // Fallback to filename parsing
                        console.log(`Using filename parsing for: ${file.name}`);
                        resolve({
                            title: this.extractTitleFromFilename(file.name),
                            artist: this.extractArtistFromFilename(file.name),
                            albumArt: null,
                            fileId: file.id,
                            fileName: file.name
                        });
                    }
                });
                
            } catch (error) {
                console.warn(`Failed to download ${file.name} for metadata extraction:`, error);
                // Fallback to filename parsing
                console.log(`Using filename fallback for: ${file.name}`);
                resolve({
                    title: this.extractTitleFromFilename(file.name),
                    artist: this.extractArtistFromFilename(file.name),
                    albumArt: null,
                    fileId: file.id,
                    fileName: file.name
                });
            }
        });
    }

    extractTitleFromFilename(fileName) {
        // Remove file extension
        const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
        
        // Try to parse "Artist - Title" format
        if (nameWithoutExt.includes(' - ')) {
            const parts = nameWithoutExt.split(' - ');
            return parts.slice(1).join(' - ').trim() || 'Unknown Title';
        }
        
        return nameWithoutExt || 'Unknown Title';
    }

    extractArtistFromFilename(fileName) {
        // Remove file extension
        const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
        
        // Try to parse "Artist - Title" format
        if (nameWithoutExt.includes(' - ')) {
            const parts = nameWithoutExt.split(' - ');
            return parts[0].trim() || 'Unknown Artist';
        }
        
        return 'Unknown Artist';
    }

    showResults() {
        console.log(`Showing results with ${this.songsData.length} songs`);
        // Update file count
        this.fileCount.textContent = `Found ${this.songsData.length} songs (Processing...)`;
        
        // Setup virtual scrolling
        console.log('Setting up virtual scrolling...');
        this.setupVirtualScrolling();
        
        if (this.songsData.length === 0) {
            console.log('No songs found, showing empty state');
            this.showEmptyState();
        } else {
            console.log('Rendering initial visible items...');
            // Render initial visible items
            this.renderVisibleItems();
        }
        
        // Show result section
        console.log('Result section displayed');
        this.resultSection.style.display = 'block';
    }

    updateResults() {
        console.log(`Updating results with ${this.songsData.length} songs`);
        // Update file count
        if (this.isProcessingComplete) {
            this.fileCount.textContent = `Found ${this.songsData.length} songs (Complete)`;
        } else {
            this.fileCount.textContent = `Found ${this.songsData.length} songs (Processing...)`;
        }
        
        // Update virtual scrolling height
        const totalHeight = this.songsData.length * this.itemHeight;
        if (this.virtualSpace) {
            this.virtualSpace.style.height = `${totalHeight}px`;
            console.log(`Updated virtual space height to ${totalHeight}px`);
        }
        
        // Re-render visible items to include new songs
        this.renderVisibleItems();
    }

    setupVirtualScrolling() {
        console.log('Setting up virtual scrolling container...');
        // Set container height and create virtual space
        this.songsContainer.style.height = `${this.containerHeight}px`;
        this.songsContainer.style.overflowY = 'auto';
        
        // Create virtual space div
        const totalHeight = this.songsData.length * this.itemHeight;
        console.log(`Virtual space dimensions: ${totalHeight}px height for ${this.songsData.length} items`);
        this.songsContainer.innerHTML = `<div class="virtual-space" style="height: ${totalHeight}px; position: relative;"></div>`;
        
        this.virtualSpace = this.songsContainer.querySelector('.virtual-space');
        console.log('Virtual scrolling setup complete');
    }

    handleScroll() {
        this.scrollTop = this.songsContainer.scrollTop;
        const newStartIndex = Math.floor(this.scrollTop / this.itemHeight);
        const newEndIndex = Math.min(newStartIndex + this.visibleItems, this.songsData.length);
        
        if (newStartIndex !== this.startIndex || newEndIndex !== this.endIndex) {
            console.log(`Scroll update: showing items ${newStartIndex}-${newEndIndex} of ${this.songsData.length}`);
            this.startIndex = newStartIndex;
            this.endIndex = newEndIndex;
            this.renderVisibleItems();
        }
    }

    renderVisibleItems() {
        if (!this.virtualSpace) return;
        
        console.log(`Rendering visible items ${this.startIndex}-${this.endIndex}`);
        // Clear existing items
        this.virtualSpace.innerHTML = '';
        
        // Render only visible items
        for (let i = this.startIndex; i < this.endIndex; i++) {
            if (i >= this.songsData.length) break;
            
            const song = this.songsData[i];
            const songCard = this.createSongCard(song, i + 1);
            songCard.style.position = 'absolute';
            songCard.style.top = `${i * this.itemHeight}px`;
            songCard.style.width = '100%';
            songCard.style.height = `${this.itemHeight - 12}px`; // Account for margin
            
            this.virtualSpace.appendChild(songCard);
        }
        console.log(`Rendered ${this.endIndex - this.startIndex} visible items`);
    }

    createSongCard(song, index) {
        const card = document.createElement('div');
        card.className = 'song-card';
        
        const albumArtSrc = song.albumArt || "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjMzMzIi8+CjxwYXRoIGQ9Ik00MCAyMEw2MCA0MEw0MCA2MEwyMCA0MEw0MCAyMFoiIGZpbGw9IiNFMEYxMUYiLz4KPC9zdmc+";
        
        card.innerHTML = `
            <div class="song-card-content">
                <div class="album-art-container">
                    <img src="${albumArtSrc}" alt="Album Art" class="album-art" loading="lazy">
                </div>
                <div class="song-info">
                    <h4 class="song-title">${this.escapeHtml(song.title)}</h4>
                    <p class="song-artist">${this.escapeHtml(song.artist)}</p>
                    <div class="song-file-id">${song.fileId}</div>
                </div>
            </div>
        `;
        
        return card;
    }

    showEmptyState() {
        this.songsContainer.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-music"></i>
                <h4>No Songs Found</h4>
                <p>Your rMusic/Songs folder appears to be empty or contains no supported audio files.</p>
            </div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async exportData() {
        try {
            console.log(`Starting export of ${this.songsData.length} songs...`);
            // Create export data
            const exportData = this.songsData.map(song => ({
                title: song.title,
                artist: song.artist,
                fileId: song.fileId,
                fileName: song.fileName
                // Note: albumArt URLs are not exported as they're temporary blob URLs
            }));
            
            console.log('Converting to JSON...');
            // Convert to JSON
            const jsonData = JSON.stringify(exportData, null, 2);
            
            console.log(`Creating download file (${jsonData.length} characters)...`);
            // Create and download file
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = url;
            a.download = 'rMusic-song-data.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            URL.revokeObjectURL(url);
            console.log('Export completed successfully');
            
            // Update button to show success
            const originalText = this.exportButton.innerHTML;
            this.exportButton.innerHTML = '<i class="fas fa-check"></i><span>Exported!</span>';
            this.exportButton.classList.add('exported');
            
            // Reset button after 2 seconds
            setTimeout(() => {
                this.exportButton.innerHTML = originalText;
                this.exportButton.classList.remove('exported');
            }, 2000);
            
        } catch (error) {
            console.error('Failed to export data:', error);
            alert('Failed to export data. Please try again.');
        }
    }

    cleanup() {
        console.log(`Cleaning up ${this.blobUrls.size} blob URLs...`);
        // Clean up all blob URLs to free memory
        this.blobUrls.forEach(url => {
            URL.revokeObjectURL(url);
        });
        this.blobUrls.clear();
        console.log('Cleanup completed');
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
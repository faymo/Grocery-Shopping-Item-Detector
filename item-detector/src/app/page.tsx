"use client"

import { useState, useEffect, useRef } from "react";
import Head from 'next/head';

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-converter';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

export default function Home() {
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [model, setModel] = useState<cocoSsd.ObjectDetection | null>(null);
  const [detections, setDetections] = useState<cocoSsd.DetectedObject[]>([]);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [speakResults, setSpeakResults] = useState(true);
  const [lastSpokenItem, setLastSpokenItem] = useState("");
  const [processingInterval, setProcessingInterval] = useState<number>(2000); // ms between predictions
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  
  // Tracking currently visible objects and which ones have been announced
  const currentlyVisibleObjectsRef = useRef<Set<string>>(new Set());
  const announcedObjectsRef = useRef<Set<string>>(new Set());
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Load the COCO-SSD model - optimized for mobile
  useEffect(() => {
    const loadModel = async () => {
      try {
        // Initialize TensorFlow.js before loading model
        await tf.ready();
        
        // Explicitly set backend to WebGL (important!)
        await tf.setBackend('webgl');
        console.log("Using TensorFlow backend:", tf.getBackend());
        
        // Create a dummy tensor to initialize the backend
        const dummyTensor = tf.zeros([1, 1, 1, 1]);
        dummyTensor.dispose();
        
        // Now load the COCO-SSD mode
        console.log("Loading COCO-SSD model...");
        const loadedModel = await cocoSsd.load({
          base: 'mobilenet_v2'
        });
        console.log("Model loaded successfully");
        
        setModel(loadedModel);
        setIsModelLoading(false);
      } catch (error) {
        console.error("Failed to load model:", error);
        setError(`Model loading error: ${error instanceof Error ? error.message : String(error)}`);
        setIsModelLoading(false);
      }
    };
    
    loadModel();
    
    // Cleanup function
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const mediaStream = videoRef.current.srcObject as MediaStream;
        mediaStream.getTracks().forEach(track => track.stop());
      }
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  // iOS-friendly camera toggle
  const toggleCamera = async () => {
    if (isCameraActive) {
      // Stop camera code stays the same...
      currentlyVisibleObjectsRef.current = new Set();
      announcedObjectsRef.current = new Set();

      if (videoRef.current && videoRef.current.srcObject) {
        const mediaStream = videoRef.current.srcObject as MediaStream;
        mediaStream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      setIsCameraActive(false);
      setDetections([]);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      speak("Camera turned off");
    } else {
      try {
        // Clear any existing errors first
        setError(null);
        
        // iOS-specific handling
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        
        // Simplified constraints for iOS
        const constraints = {
          video: { 
            facingMode: 'environment'
            // No width/height constraints for iOS
          },
          audio: false
        };
        
        console.log("Requesting camera access...");
        
        // For iOS, we need to create a temporary video element first
        // This sometimes helps trigger the permission dialog
        if (isIOS) {
          speak("Requesting camera access. Please allow when prompted.");
          
          // Create a temporary video element - this can help trigger iOS permissions
          const tempVideo = document.createElement('video');
          tempVideo.setAttribute('playsinline', 'true');
          tempVideo.setAttribute('autoplay', 'true');
          tempVideo.muted = true;
          document.body.appendChild(tempVideo);
          
          try {
            const tempStream = await navigator.mediaDevices.getUserMedia(constraints);
            tempVideo.srcObject = tempStream;
            await tempVideo.play();
            
            // Wait a moment before continuing
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Now stop this stream
            tempStream.getTracks().forEach(track => track.stop());
            document.body.removeChild(tempVideo);
          } catch (err) {
            console.log("Temp video setup failed:", err);
            // Continue with normal flow
          }
        }
        
        // Main camera access request - should trigger permission dialog
        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log("Camera access granted successfully");
        
        if (videoRef.current) {
          // Set these attributes BEFORE setting srcObject for iOS
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.setAttribute('autoplay', 'true');
          videoRef.current.muted = true;
          
          // Now set the stream
          videoRef.current.srcObject = mediaStream;
          
          try {
            // Play immediately after setting srcObject
            await videoRef.current.play();
            console.log("Video started playing successfully");
            setIsCameraActive(true);
            speak("Camera started. Scanning for items.");
            
            // Start detection after camera initializes
            setTimeout(() => {
              startDetectionInterval();
            }, 500);
          } catch (playError) {
            console.error("Play error:", playError);
            
            if (isIOS) {
              setError("iOS requires camera permission. Try: 1) Restart Safari 2) Verify camera permission in Settings > Safari > Camera 3) Add to Home Screen");
            } else {
              setError(`Camera error: ${playError instanceof Error ? playError.message : String(playError)}`);
            }
          }
        }
      } catch (error) {
        console.error("Error accessing camera:", error);
        
        // Check if this is a permission error
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isPermissionError = errorMsg.includes('Permission') || 
                                errorMsg.includes('denied') ||
                                errorMsg.includes('dismissed');
        
        if (isPermissionError) {
          setError("Camera permission denied. On iPhone: 1) Go to Settings > Safari > Camera > Allow 2) Restart Safari 3) Try again");
          speak("Camera permission denied. Please check your settings.");
        } else if (/iPad|iPhone|iPod/.test(navigator.userAgent)) {
          setError("iPhone camera access issue: 1) Make sure you're using Safari 2) Add to Home Screen for best results 3) Check Settings > Safari > Camera");
        } else {
          setError(`Camera access error: ${errorMsg}`);
        }
      }
    }
  };
  
  // Helper to detect iOS
  const isIOS = () => {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  };
  
  // Speak text using Web Speech API - iOS compatible
  const speak = (text: string) => {
    if (!speakResults) return;
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    // iOS often works better with a slight delay
    setTimeout(() => {
      window.speechSynthesis.speak(utterance);
    }, 100);
  };
  
  // Toggle speech feedback
  const toggleSpeech = () => {
    setSpeakResults(!speakResults);
    speak(speakResults ? "Voice feedback disabled" : "Voice feedback enabled");
  };
  
  // Toggle fullscreen mode for better viewing
  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    setShowControls(!isFullscreen); // Show/hide controls on fullscreen toggle
  };
  
  // Toggle controls visibility
  const toggleControls = () => {
    setShowControls(!showControls);
  };
  
  // Start periodic detection - mobile optimized
  const startDetectionInterval = () => {
    console.log("Starting detection interval");
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    // Run detection immediately once
    detectObjects();
    
    // Then set up interval using a function that gets fresh state each time
    timerRef.current = setInterval(() => {
      // Check the current state directly from videoRef instead of relying on closed-over state
      const isVideoActive = videoRef.current && 
                          videoRef.current.srcObject && 
                          !videoRef.current.paused;
                          
      if (isVideoActive && !isCameraActive) {
        console.log("Video is active but state is false - fixing state");
        setIsCameraActive(true); // Update the state to match reality
      }
      
      detectObjects();
    }, processingInterval);
  };
  
  // Detect objects in video frame - optimized for mobile
  const detectObjects = async () => {
    // Check if video is actually playing
    const isVideoPlaying = videoRef.current && 
                        videoRef.current.srcObject && 
                        !videoRef.current.paused && 
                        videoRef.current.readyState >= 2;
  
    if (!model || !videoRef.current || !canvasRef.current || !isVideoPlaying) {
      return;
    }
    
    try {
      // Create a set of currently detected object classes
      const newVisibleObjects = new Set<string>();
      
      // Detect objects with lower threshold for mobile
      const allPredictions = await model.detect(videoRef.current, undefined, 0.3);
      
      // Filter out person detections
      const predictions = allPredictions.filter(pred => pred.class !== "person");
      
      // Gather high confidence predictions
      predictions.forEach(pred => {
        if (pred.score > 0.55) { // Only track high confidence detections
          newVisibleObjects.add(pred.class);
        }
      });
      
      // Find objects that disappeared
      const disappearedObjects: string[] = [];
      currentlyVisibleObjectsRef.current.forEach(obj => {
        if (!newVisibleObjects.has(obj)) {
          disappearedObjects.push(obj);
        }
      });
      
      // Remove disappeared objects from announced list
      disappearedObjects.forEach(obj => {
        announcedObjectsRef.current.delete(obj);
      });
      
      // Update currently visible objects
      currentlyVisibleObjectsRef.current = newVisibleObjects;
      
      // Update detections state for UI
      setDetections(predictions);
      
      // Draw the current frame and detection results
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        // Set canvas dimensions
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        
        // Draw video frame
        ctx.drawImage(videoRef.current, 0, 0);
        
        // Draw bounding boxes for each detected object
        predictions.forEach(prediction => {
          // Draw only if high enough confidence
          if (prediction.score > 0.55) {
            // Get coordinates and dimensions
            const [x, y, width, height] = prediction.bbox;
            
            // Draw bounding box with iOS-style rounded corners
            ctx.strokeStyle = '#007AFF'; // iOS blue
            ctx.lineWidth = 4;
            
            // Draw rounded rectangle
            const radius = 10;
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + width - radius, y);
            ctx.arcTo(x + width, y, x + width, y + radius, radius);
            ctx.lineTo(x + width, y + height - radius);
            ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
            ctx.lineTo(x + radius, y + height);
            ctx.arcTo(x, y + height, x, y + height - radius, radius);
            ctx.lineTo(x, y + radius);
            ctx.arcTo(x, y, x + radius, y, radius);
            ctx.stroke();
            
            // Draw label with iOS-style pill shape
            const padding = 10;
            const textWidth = ctx.measureText(prediction.class).width;
            const bgWidth = textWidth + padding * 2;
            const bgHeight = 28;
            
            // Draw pill background
            ctx.fillStyle = 'rgba(0, 122, 255, 0.9)'; // iOS blue with transparency
            roundRect(ctx, x, y - bgHeight - 5, bgWidth, bgHeight, 14);
            
            // Draw label text
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 16px -apple-system, system-ui, "Segoe UI", Roboto, Helvetica';
            ctx.fillText(prediction.class, x + padding, y - 15);
            
            // Mark if this object has been announced with a checkmark
            if (announcedObjectsRef.current.has(prediction.class)) {
              const checkX = x + bgWidth - 20;
              const checkY = y - bgHeight/2 - 5;
              ctx.fillStyle = '#FFFFFF';
              ctx.font = 'bold 12px -apple-system';
              ctx.fillText('✓', checkX, checkY);
            }
          }
        });
        
        // Announce new high-confidence objects
        const highConfidencePredictions = predictions.filter(pred => 
          pred.score > 0.65 && !announcedObjectsRef.current.has(pred.class)
        );
        
        if (highConfidencePredictions.length > 0) {
          // Sort by confidence
          const topPrediction = highConfidencePredictions
            .sort((a, b) => b.score - a.score)[0];
          
          // Announce the top new object
          const className = topPrediction.class;
          console.log(`Announcing new object: ${className} (${topPrediction.score.toFixed(2)})`);
          speak(className);
          
          // Mark as announced
          announcedObjectsRef.current.add(className);
          setLastSpokenItem(className);
        }
      }
    } catch (error) {
      console.error("Error during detection:", error);
    }
  };
  
  // Helper function to draw rounded rectangles
  const roundRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ) => {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fill();
  };
  
  // Function to repeat the latest detection announcement
  const repeatLatestDetection = () => {
    // Find the top detection from current detections
    if (detections.length > 0) {
      // Sort by confidence and get the top one
      const topDetection = [...detections]
        .filter(det => det.class !== "person")
        .sort((a, b) => b.score - a.score)[0];
      
      if (topDetection) {
        console.log(`Repeating detection: ${topDetection.class}`);
        speak(`${topDetection.class}`);
      } else {
        speak("No objects currently detected");
      }
    } else {
      speak("No objects currently detected");
    }
  };
  
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        {/* Add these iOS-specific camera meta tags */}
        <meta http-equiv="permissions-policy" content="camera=(), microphone=()"/>
        <meta name="theme-color" content="#000000" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <title>Grocery Assistant</title>
      </Head>
      
      <div className={`min-h-screen bg-black text-white ${isFullscreen ? 'fixed inset-0 z-50' : ''}`} 
           style={{paddingTop: isFullscreen ? 0 : 'env(safe-area-inset-top)',
                  paddingBottom: isFullscreen ? 0 : 'env(safe-area-inset-bottom)'}}
      >
        <main className={`mx-auto ${isFullscreen ? 'p-0 h-full' : 'p-4'}`}>
          {!isFullscreen && (
            <h1 className="text-2xl font-bold text-center mb-4">Grocery Assistant</h1>
          )}
          
          {/* Model loading state */}
          {isModelLoading && (
            <div className="fixed inset-0 bg-black bg-opacity-80 flex flex-col items-center justify-center z-50">
              <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <p className="mt-4 text-xl px-8 text-center">Loading grocery recognition model...</p>
            </div>
          )}
          
          {/* Error message */}
          {error && (
            <div className="fixed bottom-20 left-0 right-0 mx-4 bg-red-800 p-4 rounded-lg mb-6 z-40">
              <p className="font-bold">Error occurred:</p>
              <p>{error}</p>
              <button 
                onClick={() => setError(null)}
                className="mt-3 bg-red-600 px-4 py-3 rounded-lg w-full"
              >
                Dismiss
              </button>
            </div>
          )}
          
          {/* Camera container */}
          <div 
            className={`relative mx-auto overflow-hidden bg-black ${
              isFullscreen 
                ? 'fixed inset-0 z-40' 
                : 'w-full aspect-video rounded-2xl border border-gray-800'
            }`}
            onClick={toggleControls}
          >
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
              autoPlay
              aria-hidden="true"
            ></video>
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-cover"
              aria-hidden="true"
            ></canvas>
            
            {!isCameraActive && !isModelLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-80">
                <p className="text-2xl">Camera is off</p>
              </div>
            )}
            
            {/* Object count badge */}
            {isCameraActive && detections.length > 0 && (
              <div className="absolute top-4 left-4 bg-black bg-opacity-70 px-3 py-1 rounded-full">
                {detections.length} {detections.length === 1 ? 'object' : 'objects'}
              </div>
            )}
            
            {/* Fullscreen toggle - Always visible regardless of showControls */}
            <button 
              onClick={(e) => {
                e.stopPropagation();
                toggleFullscreen();
              }}
              className="absolute top-4 right-4 bg-black bg-opacity-70 p-3 rounded-full z-50"
              aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {isFullscreen ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 0 16 16">
                  <path d="M5.5 0a.5.5 0 0 1 .5.5v4A1.5 1.5 0 0 1 4.5 6h-4a.5.5 0 0 1 0-1h4a.5.5 0 0 0 .5-.5v-4a.5.5 0 0 1 .5-.5zm5 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 0 .5.5h4a.5.5 0 0 1 0 1h-4A1.5 1.5 0 0 1 10 4.5v-4a.5.5 0 0 1 .5-.5zM0 10.5a.5.5 0 0 1 .5-.5h4A1.5 1.5 0 0 1 6 11.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 0-.5-.5h-4a.5.5 0 0 1-.5-.5zm10 1a1.5 1.5 0 0 1 1.5-1.5h4a.5.5 0 0 1 0 1h-4a.5.5 0 0 0-.5.5v4a.5.5 0 0 1-1 0v-4z"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 0 16 16">
                  <path d="M1.5 1a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 1 .5-.5zm13 0a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-1 0v-4a.5.5 0 0 1 .5-.5zM1.5 15a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 1 0v4a.5.5 0 0 1-.5.5zm13 0a.5.5 0 0 1-.5-.5v-4a.5.5 0 0 1 1 0v4a.5.5 0 0 1-.5.5z"/>
                </svg>
              )}
            </button>

            {/* Emergency exit fullscreen button - only shown when in fullscreen */}
            {isFullscreen && (
              <div className="fixed top-4 right-4 z-50">
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="bg-black bg-opacity-70 p-2 cursor-pointer rounded-full text-white hover:bg-opacity-90"
                  aria-label="Exit fullscreen"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            )}
          </div>
          
          {/* Mobile-optimized floating controls */}
          {(showControls || !isFullscreen) && (
            <div className={`${isFullscreen ? 'fixed bottom-20 left-0 right-0' : 'mt-4'} px-4 z-40`}>
              {/* Main controls */}
              <div className="flex justify-around gap-2">
                <button
                  onClick={toggleCamera}
                  disabled={isModelLoading}
                  className={`flex-1 py-6 rounded-full text-lg font-bold transition-colors shadow-lg ${
                    isCameraActive
                      ? "bg-red-600 active:bg-red-700"
                      : "bg-green-600 active:bg-green-700"
                  } ${isModelLoading ? "opacity-50" : ""}`}
                  aria-label={isCameraActive ? "Stop Camera" : "Start Camera"}
                >
                  {isCameraActive ? "STOP" : "START"}
                </button>
                
                <button
                  onClick={repeatLatestDetection}
                  disabled={!isCameraActive || detections.length === 0}
                  className="flex-1 py-6 rounded-full text-lg font-bold bg-yellow-600 active:bg-yellow-700 transition-colors shadow-lg disabled:opacity-50"
                  aria-label="Repeat latest detection"
                >
                  REPEAT
                </button>
                
                <button
                  onClick={toggleSpeech}
                  className={`flex-1 py-6 rounded-full text-lg font-bold transition-colors shadow-lg ${
                    speakResults ? "bg-blue-600 active:bg-blue-700" : "bg-gray-600 active:bg-gray-700"
                  }`}
                  aria-label={speakResults ? "Turn off voice" : "Turn on voice"}
                >
                  {speakResults ? "VOICE" : "MUTE"}
                </button>
              </div>
              
              {/* Detections list - collapsible on mobile */}
              {!isFullscreen && (
                <div className="mt-6 max-h-48 overflow-y-auto rounded-2xl bg-gray-900 border border-gray-800">
                  <h2 className="text-xl font-bold px-4 py-3 bg-gray-800 rounded-t-2xl">Detected Items</h2>
                  {detections.length > 0 ? (
                    <ul className="p-2">
                      {detections
                        .filter(d => d.score > 0.5)
                        .sort((a, b) => b.score - a.score)
                        .map((detection, index) => (
                        <li key={index} className="flex justify-between items-center p-3 border-b border-gray-800 last:border-none">
                          <span className="font-bold text-lg capitalize">{detection.class}</span>
                          <span className="bg-blue-600 px-3 py-1 rounded-full text-sm">
                            {(detection.score * 100).toFixed(0)}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-gray-400 p-4 text-center">
                      {isCameraActive ? "Scanning for items..." : "Start the camera to detect items"}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          
          {/* Instructions - only show when not fullscreen */}
          {!isFullscreen && (
            <div className="mt-6 mb-16 p-4 bg-gray-900 rounded-2xl border border-gray-800">
              <h2 className="text-lg font-bold mb-2">Tips for iOS Users</h2>
              <ul className="space-y-2">
                <li>• Allow camera permissions when prompted</li>
                <li>• Hold phone steady for better detection</li>
                <li>• Tap the screen to hide/show controls</li>
              </ul>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
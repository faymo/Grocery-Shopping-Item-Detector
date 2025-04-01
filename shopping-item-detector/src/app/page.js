"use client"

import { useState, useEffect, useRef } from "react";
import Head from 'next/head';

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-converter';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

export default function Home() {
  const [isModelLoading, setIsModelLoading] = useState(true);
  const [model, setModel] = useState(null);
  const [detections, setDetections] = useState([]);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [speakResults, setSpeakResults] = useState(true);
  const [isGrayscale, setIsGrayscale] = useState(false);
  const [lastSpokenItem, setLastSpokenItem] = useState("");
  const [processingInterval, setProcessingInterval] = useState(500); // ms between predictions
  const [error, setError] = useState(null);
  const [showControls, setShowControls] = useState(true);
  
  // Tracking currently visible objects and which ones have been announced
  const currentlyVisibleObjectsRef = useRef(new Set());
  const announcedObjectsRef = useRef(new Set());
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const timerRef = useRef(null);
  
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
        
        // Now load the COCO-SSD model - use lite version for mobile
        console.log("Loading COCO-SSD model...");
        const loadedModel = await cocoSsd.load({
          base: 'mobilenet_v2' // Use lite version for better mobile performance
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
        const mediaStream = videoRef.current.srcObject;
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
      // Stop camera
      currentlyVisibleObjectsRef.current = new Set();
      announcedObjectsRef.current = new Set();

      if (videoRef.current && videoRef.current.srcObject) {
        const mediaStream = videoRef.current.srcObject;
        mediaStream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
      setIsCameraActive(false);
      setDetections([]);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      // Optional feedback
      if (speakResults) speak("Camera turned off");
    } else {
      try {
        // Clear any previous errors
        setError(null);
        
        // Request camera access
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment', // This specifies the rear camera
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }
        });
        // Make sure we have valid references before proceeding
        if (videoRef.current) {
          // Important: set attributes before setting srcObject
          videoRef.current.setAttribute('playsinline', 'true'); // Critical for iOS
          videoRef.current.setAttribute('autoplay', 'true');
          videoRef.current.muted = true;
          
          // Then set stream
          videoRef.current.srcObject = stream;
          
          // Try to play the video right away
          try {
            await videoRef.current.play();
            console.log("Camera started successfully");
            
            // Set state to active first
            setIsCameraActive(true);
            
            // Start detection after camera is fully active
            setTimeout(() => {
              if (videoRef.current?.srcObject) { // Double-check stream is still active
                startDetectionInterval();
                if (speakResults) speak("Camera started. Scanning for items.");
              }
            }, 1000); // Increased from 500ms to 1000ms for more stability
          } catch (playError) {
            console.error("Error playing video:", playError);
            setError("Camera permission granted but couldn't start video. Please try again.");
          }
        }
      } catch (error) {
        console.error("Error accessing camera:", error);
        setError(`Camera access error: ${error instanceof Error ? error.message : String(error)}`);
        
      }
    }
  };
  
  // Speak text using Web Speech API - iOS compatible
  const speak = (text) => {
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
      // Only check for video activity without logging or state fixing
      // This eliminates the console spam
      const isVideoActive = videoRef.current && 
                           videoRef.current.srcObject && 
                           !videoRef.current.paused;
      
      // Only run detection if video is actually active
      if (isVideoActive) {
        detectObjects();
      }
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
      const newVisibleObjects = new Set();
      
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
      const disappearedObjects = [];
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
        
        // Clear canvas first
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        
        // Draw video frame
        ctx.drawImage(videoRef.current, 0, 0);
        
        // Capture the current grayscale state to avoid race conditions
        const shouldApplyGrayscale = isGrayscale;
        
        // Apply high-contrast black and white effect if enabled - Mobile Compatible Version
        if (shouldApplyGrayscale) {
          try {
            // Mobile-compatible approach using direct pixel manipulation
            const imageData = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
            const data = imageData.data;
            
            // Apply high-contrast grayscale - optimize for faster processing
            for (let i = 0; i < data.length; i += 4) {
              // Convert to grayscale with human-perception weights
              const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
              
              // Apply contrast - increase difference between light and dark
              const contrastFactor = 2.0; // Increased for more pronounced effect
              const brightnessFactor = 20; // Adjusted for better visibility
              
              // Apply contrast and brightness adjustments
              let contrast = (gray - 128) * contrastFactor + 128 + brightnessFactor;
              
              // Clamp values between 0 and 255
              contrast = Math.max(0, Math.min(255, contrast));
              
              // Set all RGB channels to the same value for grayscale
              data[i] = contrast;     // Red
              data[i + 1] = contrast; // Green
              data[i + 2] = contrast; // Blue
              // Alpha remains unchanged (data[i + 3])
            }
            
            // Write the modified image data back to the canvas
            ctx.putImageData(imageData, 0, 0);
          } catch (err) {
            console.error("Error applying high-contrast filter:", err);
          }
        }
        
        // Draw bounding boxes for each detected object
        predictions.forEach(prediction => {
          // Draw only if high enough confidence
          if (prediction.score > 0.55) {
            // Get coordinates and dimensions
            const [x, y, width, height] = prediction.bbox;
            
            // Draw bounding box with neon style
            ctx.strokeStyle = '#00FFFF'; // Neon cyan
            ctx.lineWidth = 4;
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#00FFFF';
            
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
            
            // Reset shadow for text
            ctx.shadowBlur = 0;
            
            // Draw label with neon pill shape
            const padding = 10;
            const textWidth = ctx.measureText(prediction.class).width;
            const bgWidth = textWidth + padding * 2;
            const bgHeight = 28;
            
            // Draw pill background
            ctx.fillStyle = 'rgba(0, 255, 255, 0.8)'; // Neon cyan with transparency
            roundRect(ctx, x, y - bgHeight - 5, bgWidth, bgHeight, 14);
            
            // Draw label text with glow
            ctx.fillStyle = '#FFFFFF';
            ctx.shadowBlur = 8;
            ctx.shadowColor = '#00FFFF';
            ctx.font = 'bold 16px -apple-system, system-ui, "Segoe UI", Roboto, Helvetica';
            ctx.fillText(prediction.class, x + padding, y - 15);
            
            // Reset shadow
            ctx.shadowBlur = 0;
            
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
    ctx,
    x,
    y,
    width,
    height,
    radius
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
  
  // Toggle grayscale filter - modified to be more robust
  const toggleGrayscale = () => {
    setIsGrayscale(prev => {
      const newValue = !prev;
      console.log("High-contrast mode toggled:", newValue);
      
      // Force an immediate re-detection after a short delay to ensure state is updated
      setTimeout(() => {
        if (isCameraActive && videoRef.current && videoRef.current.srcObject) {
          console.log("Forcing detection after toggle");
          detectObjects();
        }
      }, 50);
      
      return newValue;
    });
  };

  // Listen for grayscale toggle and announce changes
  useEffect(() => {
    if (isCameraActive) {
      // Announce change in mode
      if (isGrayscale) {
        if (speakResults) speak("High contrast mode enabled");
      } else {
        if (speakResults) speak("Color mode enabled");
      }
      
      // Force multiple detections to ensure the UI is properly updated
      if (videoRef.current && videoRef.current.srcObject) {
        console.log("Forcing multiple detections after filter change");
        
        // Clear any existing detection interval
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
        
        // Run immediate detections
        detectObjects();
        
        // Schedule a few more detections with delays to ensure complete update
        setTimeout(() => detectObjects(), 100);
        setTimeout(() => detectObjects(), 300);
        
        // Then restart the regular detection interval
        setTimeout(() => {
          startDetectionInterval();
        }, 500);
      }
    }
  }, [isGrayscale]);
  
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <title>Grocery Assistant</title>
      </Head>
      
      <style jsx global>{`
        :root {
          --neon-green: #39FF14;
          --neon-green-hover: #50FF30;
          --neon-red: #FF3131;
          --neon-red-hover: #FF5050;
          --neon-blue: #00FFFF;
          --neon-blue-hover: #40FFFF;
          --neon-yellow: #FFFF00;
          --neon-yellow-hover: #FFFF40;
          --neon-purple: #FF00FF;
          --neon-purple-hover: #FF40FF;
          --neon-gray: #AAAAAA;
          --neon-gray-hover: #BBBBBB;
        }
        
        .neon-green {
          background-color: var(--neon-green);
          box-shadow: 0 0 10px var(--neon-green), 0 0 20px var(--neon-green);
        }
        .neon-green:active {
          background-color: var(--neon-green-hover);
        }
        
        .neon-red {
          background-color: var(--neon-red);
          box-shadow: 0 0 10px var(--neon-red), 0 0 20px var(--neon-red);
        }
        .neon-red:active {
          background-color: var(--neon-red-hover);
        }
        
        .neon-blue {
          background-color: var(--neon-blue);
          box-shadow: 0 0 10px var(--neon-blue), 0 0 20px var(--neon-blue);
        }
        .neon-blue:active {
          background-color: var(--neon-blue-hover);
        }
        
        .neon-yellow {
          background-color: var(--neon-yellow);
          box-shadow: 0 0 10px var(--neon-yellow), 0 0 20px var(--neon-yellow);
        }
        .neon-yellow:active {
          background-color: var(--neon-yellow-hover);
        }
        
        .neon-purple {
          background-color: var(--neon-purple);
          box-shadow: 0 0 10px var (--neon-purple), 0 0 20px var(--neon-purple);
        }
        .neon-purple:active {
          background-color: var(--neon-purple-hover);
        }
        
        .neon-gray {
          background-color: var(--neon-gray);
          box-shadow: 0 0 10px var(--neon-gray), 0 0 20px var(--neon-gray);
        }
        .neon-gray:active {
          background-color: var(--neon-gray-hover);
        }
        
        .neon-border {
          border-color: var(--neon-blue);
          box-shadow: 0 0 5px var(--neon-blue);
        }
        
        .neon-text {
          color: #FFFFFF;
          text-shadow: 0 0 5px #FFFFFF, 0 0 10px var(--neon-blue);
        }
        
        .neon-spinner {
          border-color: var(--neon-blue);
          border-top-color: transparent;
          box-shadow: 0 0 15px var(--neon-blue);
        }
      `}</style>
      
      <div className="min-h-screen bg-black text-white"
           style={{paddingTop: 'env(safe-area-inset-top)',
                  paddingBottom: 'env(safe-area-inset-bottom)'}}
      >
        <main className="mx-auto p-4">
          <h1 className="text-2xl font-bold text-center mb-4 neon-text">Grocery Assistant</h1>
          
          {/* Model loading state */}
          {isModelLoading && (
            <div className="fixed inset-0 bg-black bg-opacity-80 flex flex-col items-center justify-center z-50">
              <div className="w-16 h-16 border-4 neon-spinner rounded-full animate-spin"></div>
              <p className="mt-4 text-xl px-8 text-center neon-text">Loading grocery recognition model...</p>
            </div>
          )}
          
          {/* Error message */}
          {error && (
            <div className="fixed bottom-20 left-0 right-0 mx-4 neon-red p-4 rounded-lg mb-6 z-40">
              <p className="font-bold">Error occurred:</p>
              <p>{error}</p>
              <button 
                onClick={() => setError(null)}
                className="mt-3 neon-red px-4 py-3 rounded-lg w-full"
              >
                Dismiss
              </button>
            </div>
          )}
          
          {/* Top Controls */}
          {showControls && (
            <div className="mb-4">
              {/* Main controls */}
              <div className="flex justify-around gap-2">
                <button
                  onClick={toggleCamera}
                  disabled={isModelLoading}
                  className={`flex-1 py-4 rounded-full text-lg font-bold transition-colors shadow-lg ${
                    isCameraActive
                      ? "neon-red"
                      : "neon-green"
                  } ${isModelLoading ? "opacity-50" : ""}`}
                  aria-label={isCameraActive ? "Stop Camera" : "Start Camera"}
                >
                  {isCameraActive ? "STOP" : "START"}
                </button>
                
                <button
                  onClick={repeatLatestDetection}
                  disabled={!isCameraActive || detections.length === 0}
                  className="flex-1 py-4 rounded-full text-lg font-bold neon-yellow transition-colors shadow-lg disabled:opacity-50"
                  aria-label="Repeat latest detection"
                >
                  REPEAT
                </button>
                
                <button
                  onClick={toggleGrayscale}
                  className={`flex-1 py-4 rounded-full text-lg font-bold transition-colors shadow-lg ${
                    isGrayscale ? "neon-purple" : "neon-gray"
                  }`}
                  aria-label={isGrayscale ? "Turn off high contrast" : "Turn on high contrast"}
                >
                  {isGrayscale ? "COLOR" : "HI-CON"}
                </button>
              </div>
            </div>
          )}
          
          {/* Camera container */}
          <div 
            className="relative mx-auto overflow-hidden bg-black w-full h-[65vh] max-h-[70vh] md:aspect-video rounded-2xl border neon-border"
            onClick={toggleControls}
          >
            <video
              ref={videoRef}
              className={`absolute inset-0 w-full h-full object-cover`}
              playsInline={true}
              muted={true}
              autoPlay={true}
              style={{
                display: isCameraActive ? 'block' : 'none'
              }}
            ></video>
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full object-cover"
              aria-hidden="true"
            ></canvas>
            
            {/* Grayscale indicator - Updated text */}
            {isCameraActive && isGrayscale && (
              <div className="absolute bottom-4 left-4 neon-purple px-3 py-1 rounded-full text-sm">
                High Contrast Mode
              </div>
            )}
            
            {!isCameraActive && !isModelLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-80">
                <p className="text-2xl neon-text">Camera is off</p>
              </div>
            )}
            
            {/* Camera status indicator */}
            {isCameraActive && (
              <div className="absolute top-4 left-4 neon-green px-3 py-1 rounded-full text-sm">
                Camera Active
              </div>
            )}
            
            {/* Object count badge */}
            {isCameraActive && detections.length > 0 && (
              <div className="absolute top-4 right-4 bg-black bg-opacity-70 px-3 py-1 rounded-full neon-text">
                {detections.length} {detections.length === 1 ? 'object' : 'objects'}
              </div>
            )}
          </div>
          
          {/* Detections list */}
          {showControls && detections.length > 0 && (
            <div className="mt-6 max-h-48 overflow-y-auto rounded-2xl bg-black border neon-border">
              <h2 className="text-xl font-bold px-4 py-3 neon-text rounded-t-2xl">Detected Items</h2>
              <ul className="p-2">
                {detections
                  .filter(d => d.score > 0.5)
                  .sort((a, b) => b.score - a.score)
                  .map((detection, index) => (
                  <li key={index} className="flex justify-between items-center p-3 border-b border-gray-800 last:border-none">
                    <span className="font-bold text-lg capitalize neon-text">{detection.class}</span>
                    <span className="neon-blue px-3 py-1 rounded-full text-sm">
                      {(detection.score * 100).toFixed(0)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>
      </div>
    </>
  );
}
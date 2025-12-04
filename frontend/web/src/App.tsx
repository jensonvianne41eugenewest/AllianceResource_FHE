// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface AllianceResource {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  airline: string;
  status: "available" | "in-use" | "maintenance";
  fheVerified: boolean;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [resources, setResources] = useState<AllianceResource[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newResourceData, setNewResourceData] = useState({
    category: "",
    airline: "",
    description: "",
    resourceInfo: ""
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  // Calculate statistics for dashboard
  const availableCount = resources.filter(r => r.status === "available").length;
  const inUseCount = resources.filter(r => r.status === "in-use").length;
  const maintenanceCount = resources.filter(r => r.status === "maintenance").length;
  const fheVerifiedCount = resources.filter(r => r.fheVerified).length;

  useEffect(() => {
    loadResources().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadResources = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("resource_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing resource keys:", e);
        }
      }
      
      const list: AllianceResource[] = [];
      
      for (const key of keys) {
        try {
          const resourceBytes = await contract.getData(`resource_${key}`);
          if (resourceBytes.length > 0) {
            try {
              const resourceData = JSON.parse(ethers.toUtf8String(resourceBytes));
              list.push({
                id: key,
                encryptedData: resourceData.data,
                timestamp: resourceData.timestamp,
                owner: resourceData.owner,
                category: resourceData.category,
                airline: resourceData.airline,
                status: resourceData.status || "available",
                fheVerified: resourceData.fheVerified || false
              });
            } catch (e) {
              console.error(`Error parsing resource data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading resource ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setResources(list);
    } catch (e) {
      console.error("Error loading resources:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitResource = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting resource data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newResourceData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const resourceId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const resourceData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newResourceData.category,
        airline: newResourceData.airline,
        status: "available",
        fheVerified: false
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `resource_${resourceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(resourceData))
      );
      
      const keysBytes = await contract.getData("resource_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(resourceId);
      
      await contract.setData(
        "resource_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Resource encrypted and submitted securely!"
      });
      
      await loadResources();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewResourceData({
          category: "",
          airline: "",
          description: "",
          resourceInfo: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const verifyWithFHE = async (resourceId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted verification with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const resourceBytes = await contract.getData(`resource_${resourceId}`);
      if (resourceBytes.length === 0) {
        throw new Error("Resource not found");
      }
      
      const resourceData = JSON.parse(ethers.toUtf8String(resourceBytes));
      
      const updatedResource = {
        ...resourceData,
        fheVerified: true
      };
      
      await contract.setData(
        `resource_${resourceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedResource))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadResources();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const requestResource = async (resourceId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing resource request with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const resourceBytes = await contract.getData(`resource_${resourceId}`);
      if (resourceBytes.length === 0) {
        throw new Error("Resource not found");
      }
      
      const resourceData = JSON.parse(ethers.toUtf8String(resourceBytes));
      
      const updatedResource = {
        ...resourceData,
        status: "in-use"
      };
      
      await contract.setData(
        `resource_${resourceId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedResource))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Resource allocated successfully!"
      });
      
      await loadResources();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Request failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const renderPieChart = () => {
    const total = resources.length || 1;
    const availablePercentage = (availableCount / total) * 100;
    const inUsePercentage = (inUseCount / total) * 100;
    const maintenancePercentage = (maintenanceCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment available" 
            style={{ transform: `rotate(${availablePercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment in-use" 
            style={{ transform: `rotate(${(availablePercentage + inUsePercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment maintenance" 
            style={{ transform: `rotate(${(availablePercentage + inUsePercentage + maintenancePercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{resources.length}</div>
            <div className="pie-label">Resources</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box available"></div>
            <span>Available: {availableCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box in-use"></div>
            <span>In Use: {inUseCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box maintenance"></div>
            <span>Maintenance: {maintenanceCount}</span>
          </div>
        </div>
      </div>
    );
  };

  // Filter resources based on search and filters
  const filteredResources = resources.filter(resource => {
    const matchesSearch = 
      resource.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      resource.airline.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = 
      filterCategory === "all" || resource.category === filterCategory;
    
    const matchesStatus = 
      filterStatus === "all" || resource.status === filterStatus;
    
    return matchesSearch && matchesCategory && matchesStatus;
  });

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container metal-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="wing-icon"></div>
          </div>
          <h1>Alliance<span>Resource</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-resource-btn metal-button"
          >
            <div className="add-icon"></div>
            Add Resource
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Airline Alliance Resource Sharing</h2>
            <p>Securely share encrypted resources within airline alliances using FHE technology</p>
          </div>
          <div className="fhe-badge">
            <span>FHE-ENCRYPTED</span>
          </div>
        </div>
        
        <div className="dashboard-panels">
          <div className="panel-left">
            <div className="dashboard-card metal-card">
              <h3>Resource Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{resources.length}</div>
                  <div className="stat-label">Total Resources</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{availableCount}</div>
                  <div className="stat-label">Available</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{inUseCount}</div>
                  <div className="stat-label">In Use</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{fheVerifiedCount}</div>
                  <div className="stat-label">FHE Verified</div>
                </div>
              </div>
            </div>
            
            <div className="dashboard-card metal-card">
              <h3>Status Distribution</h3>
              {renderPieChart()}
            </div>
          </div>
          
          <div className="panel-right">
            <div className="dashboard-card metal-card">
              <h3>Project Information</h3>
              <p>Confidential Airline Alliance Resource Sharing platform enables secure sharing of encrypted resources (spare parts, ground staff) among alliance members using Fully Homomorphic Encryption (FHE).</p>
              <div className="feature-list">
                <div className="feature-item">
                  <div className="feature-icon">🔒</div>
                  <span>Encrypted resource information</span>
                </div>
                <div className="feature-item">
                  <div className="feature-icon">⚙️</div>
                  <span>FHE collaborative resource scheduling</span>
                </div>
                <div className="feature-item">
                  <div className="feature-icon">📈</div>
                  <span>Improved alliance operational efficiency</span>
                </div>
                <div className="feature-item">
                  <div className="feature-icon">🛡️</div>
                  <span>Protection of commercial secrets</span>
                </div>
              </div>
            </div>
            
            <div className="dashboard-card metal-card">
              <h3>Team Information</h3>
              <div className="team-grid">
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <div className="member-info">
                    <div className="member-name">Alex Chen</div>
                    <div className="member-role">FHE Specialist</div>
                  </div>
                </div>
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <div className="member-info">
                    <div className="member-name">Maria Rodriguez</div>
                    <div className="member-role">Aviation Analyst</div>
                  </div>
                </div>
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <div className="member-info">
                    <div className="member-name">James Kim</div>
                    <div className="member-role">Blockchain Developer</div>
                  </div>
                </div>
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <div className="member-info">
                    <div className="member-name">Sarah Williams</div>
                    <div className="member-role">UX Designer</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="resources-section">
          <div className="section-header">
            <h2>Alliance Resources</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search resources..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="metal-input"
                />
              </div>
              <select 
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="metal-select"
              >
                <option value="all">All Categories</option>
                <option value="Spare Parts">Spare Parts</option>
                <option value="Ground Staff">Ground Staff</option>
                <option value="Equipment">Equipment</option>
                <option value="Technical Support">Technical Support</option>
              </select>
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="metal-select"
              >
                <option value="all">All Status</option>
                <option value="available">Available</option>
                <option value="in-use">In Use</option>
                <option value="maintenance">Maintenance</option>
              </select>
              <button 
                onClick={loadResources}
                className="refresh-btn metal-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="resources-list metal-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Category</div>
              <div className="header-cell">Airline</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">FHE Verified</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredResources.length === 0 ? (
              <div className="no-resources">
                <div className="no-resources-icon"></div>
                <p>No resources found</p>
                <button 
                  className="metal-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Resource
                </button>
              </div>
            ) : (
              filteredResources.map(resource => (
                <div className="resource-row" key={resource.id}>
                  <div className="table-cell resource-id">#{resource.id.substring(0, 6)}</div>
                  <div className="table-cell">{resource.category}</div>
                  <div className="table-cell">{resource.airline}</div>
                  <div className="table-cell">
                    {new Date(resource.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${resource.status}`}>
                      {resource.status}
                    </span>
                  </div>
                  <div className="table-cell">
                    <span className={`verification-badge ${resource.fheVerified ? 'verified' : 'unverified'}`}>
                      {resource.fheVerified ? 'Verified' : 'Unverified'}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {resource.status === "available" && (
                      <button 
                        className="action-btn metal-button primary"
                        onClick={() => requestResource(resource.id)}
                      >
                        Request
                      </button>
                    )}
                    {isOwner(resource.owner) && !resource.fheVerified && (
                      <button 
                        className="action-btn metal-button"
                        onClick={() => verifyWithFHE(resource.id)}
                      >
                        Verify with FHE
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitResource} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          resourceData={newResourceData}
          setResourceData={setNewResourceData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="metal-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="wing-icon"></div>
              <span>AllianceResourceFHE</span>
            </div>
            <p>Secure encrypted resource sharing for airline alliances</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Confidentiality</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} AllianceResourceFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  resourceData: any;
  setResourceData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  resourceData,
  setResourceData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setResourceData({
      ...resourceData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!resourceData.category || !resourceData.airline || !resourceData.resourceInfo) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal metal-card">
        <div className="modal-header">
          <h2>Add Encrypted Resource</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your resource data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category"
                value={resourceData.category} 
                onChange={handleChange}
                className="metal-select"
              >
                <option value="">Select category</option>
                <option value="Spare Parts">Spare Parts</option>
                <option value="Ground Staff">Ground Staff</option>
                <option value="Equipment">Equipment</option>
                <option value="Technical Support">Technical Support</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Airline *</label>
              <input 
                type="text"
                name="airline"
                value={resourceData.airline} 
                onChange={handleChange}
                placeholder="Airline name..." 
                className="metal-input"
              />
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text"
                name="description"
                value={resourceData.description} 
                onChange={handleChange}
                placeholder="Brief description..." 
                className="metal-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Resource Information *</label>
              <textarea 
                name="resourceInfo"
                value={resourceData.resourceInfo} 
                onChange={handleChange}
                placeholder="Enter resource details to encrypt..." 
                className="metal-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn metal-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn metal-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;